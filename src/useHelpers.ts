import React from "react";
import {useQueryClient, QueryClient} from "react-query";
import {SetOptions} from "@firebase/firestore-types";

import {collectionCache} from "./Cache";
import {empty, FirebaseHelpersOptions} from "./types";
import {useFirestore} from "./Provider";

export function useIsMounted() {
    const mountedRef = React.useRef(false);
    const isMounted = React.useCallback(() => mountedRef.current, []);

    React.useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    });

    return isMounted;
}

function updateCollectionCache<Doc extends Record<string, unknown>>(
    queryClient: QueryClient,
    path: string,
    callback: (currentState: Doc[], docId?: string) => Doc[],
    identityState?: string,
    identityField = "id",
) {
    let collection: string | string[] = path.split("/").filter(Boolean);
    const docId = collection.pop(); // remove last item, which is the /doc-id
    collection = collection.join("/");

    collectionCache.getKeysFromCollectionPath(collection).forEach((key) => {
        queryClient.setQueryData(key, (currentState: Doc[] = empty.array) => {
            const state =
                identityState && !Array.isArray(currentState)
                    ? currentState[identityState]
                    : currentState;
            // don't mutate the current state if it doesn't include this doc
            // why? to prevent creating a new reference of the state
            // creating a new reference could trigger unnecessary re-renders
            if (!state?.some((doc: Doc) => doc[identityField] === docId)) {
                return currentState;
            }

            const queryState = callback(state, docId);
            return identityState
                ? {
                      ...currentState,
                      [identityState]: queryState,
                  }
                : queryState;
        });
    });
}

export const useHelpers = () => {
    const {firestore} = useFirestore();
    const queryClient = useQueryClient();

    /**
     * `addToCollectionCache(path, queryString?)`: wrapper for addCollectionToCache from internal Cache.
     * you cann call this when you want to add a collection to the cache if it was not requested
     * by firestore, e.g. a direct axios call.
     * so that we can mutate it from document calls later
     */
    const addToCollectionCache = (path: string, queryString?: string) => {
        collectionCache.addCollectionToCache(path, queryString);
    };

    /**
     * `setDocument(path, data, SetOptions?)`: Extends the `firestore` document `set` function.
     * - You can call this when you want to edit your document.
     * - It also updates the local cache using. This will prove highly convenient over the regular Firestore `set` function.
     * - The third argument is the same as the second argument for [Firestore `set`](https://firebase.google.com/docs/firestore/manage-data/add-data#set_a_document).
     */
    const setDocument = <Data extends unknown>(
        path: string | undefined,
        data: Partial<Data>,
        options?: SetOptions,
        {
            ignoreLocalMutation = false,
            identityState,
            identityField = "id",
        }: FirebaseHelpersOptions = {},
    ) => {
        if (!path) return undefined;

        const isDocument =
            path.trim().split("/").filter(Boolean).length % 2 === 0;

        if (!isDocument)
            throw new Error(
                `[react-query-firestore] error: called set() function with path: ${path}. This is not a valid document path. data: ${JSON.stringify(
                    data,
                )}`,
            );

        if (!ignoreLocalMutation) {
            queryClient.setQueryData<Partial<Data>>(path, (prevState) => {
                // default we set merge to be false. this is annoying, but follows Firestore's preference.
                if (!options?.merge) return data;
                return {
                    ...prevState,
                    ...data,
                };
            });
        }

        updateCollectionCache(
            queryClient,
            path,
            (currentState, docId) => {
                return currentState.map((document) => {
                    if (document[identityField] === docId) {
                        if (!options?.merge) return document;
                        return {...document, ...data};
                    }
                    return document;
                });
            },
            identityState,
            identityField,
        );

        return firestore.doc(path).set(data, options || {});
    };

    /**
     * - `updateDocument(path, data)`: Extends the Firestore document [`update` function](https://firebase.google.com/docs/firestore/manage-data/add-data#update-data).
     * - It also updates the local cache using. This will prove highly convenient over the regular `set` function.
     */
    const updateDocument = <Data extends unknown>(
        path: string | undefined,
        data: Partial<Data>,
        {
            ignoreLocalMutation = false,
            identityState,
            identityField = "id",
        }: FirebaseHelpersOptions = {},
    ) => {
        if (!path) return undefined;
        const isDocument =
            path.trim().split("/").filter(Boolean).length % 2 === 0;

        if (!isDocument)
            throw new Error(
                `[react-query-firestore] error: called update function with path: ${path}. This is not a valid document path. data: ${JSON.stringify(
                    data,
                )}`,
            );

        if (!ignoreLocalMutation) {
            queryClient.setQueryData<Partial<Data>>(path, (prevState) => {
                return {
                    ...prevState,
                    ...data,
                };
            });
        }

        updateCollectionCache(
            queryClient,
            path,
            (currentState, docId) => {
                return currentState.map((document) => {
                    if (document[identityField] === docId) {
                        return {...document, ...data};
                    }
                    return document;
                });
            },
            identityState,
            identityField,
        );

        return firestore.doc(path).update(data);
    };

    const deleteDocument = (
        path: string | undefined,
        {
            ignoreLocalMutation = false,
            identityState,
            identityField = "id",
        }: FirebaseHelpersOptions = {},
    ) => {
        if (!path) return undefined;

        const isDocument =
            path.trim().split("/").filter(Boolean).length % 2 === 0;

        if (!isDocument)
            throw new Error(
                `[react-query-firestore] error: called delete() function with path: ${path}. This is not a valid document path.`,
            );

        if (!ignoreLocalMutation) {
            queryClient.setQueryData(path, null);
        }

        updateCollectionCache(
            queryClient,
            path,
            (currentState, docId) => {
                return currentState.filter((document) => {
                    if (!document) return false;
                    if (document[identityField] === docId) {
                        // delete this doc
                        return false;
                    }
                    return true;
                });
            },
            identityState,
            identityField,
        );

        return firestore.doc(path).delete();
    };

    return {
        setDocument,
        updateDocument,
        deleteDocument,
        addToCollectionCache,
    };
};
