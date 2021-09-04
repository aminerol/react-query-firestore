import React from "react";
import {useQueryClient, QueryClient} from "react-query";
import {SetOptions} from "@firebase/firestore-types";

import {collectionCache} from "./Cache";
import {empty} from "./types";
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
) {
    let collection: string | string[] = path.split("/").filter(Boolean);
    const docId = collection.pop(); // remove last item, which is the /doc-id
    collection = collection.join("/");

    collectionCache.getKeysFromCollectionPath(collection).forEach((key) => {
        queryClient.setQueryData(key, (currentState: Doc[] = empty.array) => {
            // don't mutate the current state if it doesn't include this doc
            // why? to prevent creating a new reference of the state
            // creating a new reference could trigger unnecessary re-renders
            if (!currentState.some((doc) => doc.id === docId)) {
                return currentState;
            }
            return callback(currentState, docId);
        });
    });
}

export const useHelpers = () => {
    const {firestore} = useFirestore();
    const queryClient = useQueryClient();

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
        /**
         * If true, the local cache won't be updated. Default `false`.
         */
        ignoreLocalMutation = false,
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

        updateCollectionCache(queryClient, path, (currentState, docId) => {
            return currentState.map((document) => {
                if (document.id === docId) {
                    if (!options?.merge) return document;
                    return {...document, ...data};
                }
                return document;
            });
        });

        return firestore.doc(path).set(data, options || {});
    };

    /**
     * - `updateDocument(path, data)`: Extends the Firestore document [`update` function](https://firebase.google.com/docs/firestore/manage-data/add-data#update-data).
     * - It also updates the local cache using. This will prove highly convenient over the regular `set` function.
     */
    const updateDocument = <Data extends unknown>(
        path: string | undefined,
        data: Partial<Data>,
        /**
         * If true, the local cache won't be updated. Default `false`.
         */
        ignoreLocalMutation = false,
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

        updateCollectionCache(queryClient, path, (currentState, docId) => {
            return currentState.map((document) => {
                if (document.id === docId) {
                    return {...document, ...data};
                }
                return document;
            });
        });

        return firestore.doc(path).update(data);
    };

    const deleteDocument = (
        path: string | undefined,
        /**
         * If true, the local cache won't be updated immediately. Default `false`.
         */
        ignoreLocalMutation = false,
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

            updateCollectionCache(queryClient, path, (currentState, docId) => {
                return currentState.filter((document) => {
                    if (!document) return false;
                    if (document.id === docId) {
                        // delete this doc
                        return false;
                    }
                    return true;
                });
            });
        }

        return firestore.doc(path).delete();
    };

    return {
        setDocument,
        updateDocument,
        deleteDocument,
    };
};
