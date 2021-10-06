import {useCallback, useEffect, useRef} from "react";
import {useQuery, useQueryClient, QueryClient} from "react-query";
import {
    FieldValue,
    FirebaseFirestore,
    SetOptions,
} from "@firebase/firestore-types";

import {collectionCache} from "./Cache";
import {ListenerReturnType, AllowType, Document, empty, Options} from "./types";
import {useHelpers} from "./useHelpers";
import {useFirestore} from "./Provider";

function updateCollectionCache<Doc extends Document = Document>(
    queryClient: QueryClient,
    path: string,
    docId: string,
    data: any,
) {
    let collection: string | string[] = path.split(`/${docId}`).filter(Boolean);
    collection = collection.join("/");

    if (collection) {
        collectionCache.getKeysFromCollectionPath(collection).forEach((key) => {
            queryClient.setQueryData<Doc[]>(
                key,
                (currentState = empty.array) => {
                    // don't mutate the current state if it doesn't include this doc
                    if (
                        !currentState.some(
                            (currDoc) => currDoc.id && currDoc.id === data.id,
                        )
                    ) {
                        return currentState;
                    }
                    return currentState.map((document) => {
                        if (document.id === data.id) {
                            return data;
                        }
                        return document;
                    });
                },
            );
        });
    }
}

const createListenerAsync = async <Doc extends Document = Document>(
    firestore: FirebaseFirestore,
    queryClient: QueryClient,
    path?: string,
): Promise<ListenerReturnType<Doc>> => {
    if (!path) {
        return {unsubscribe: empty.function, initialData: empty.object as Doc};
    }
    return await new Promise((resolve, reject) => {
        const unsubscribe = firestore.doc(path).onSnapshot((doc) => {
            const docData = doc.data() ?? empty.object;
            const data = {
                ...docData,
                id: doc.id,
                exists: doc.exists,
                hasPendingWrites: doc.metadata.hasPendingWrites,
            } as Doc;
            if (!data.hasPendingWrites) {
                queryClient.setQueryData(path, data);
                updateCollectionCache(queryClient, path, doc.id, data);
                resolve({
                    initialData: data,
                    unsubscribe,
                });
            }
        }, reject);
    });
};

export const useDocument = <Data extends unknown, TransData = Document<Data>>(
    path?: string,
    options?: Options<Document<Data>, TransData>,
) => {
    const {firestore} = useFirestore();
    const {deleteDocument: deleteDoc} = useHelpers();
    const queryClient = useQueryClient();
    const unsubscribeRef = useRef<ListenerReturnType["unsubscribe"] | null>(
        null,
    );

    useEffect(() => {
        return () => {
            // clean up listener on unmount if it exists
            if (unsubscribeRef.current) {
                unsubscribeRef.current();
                unsubscribeRef.current = null;
            }
        };
    }, [path]);

    async function fetch() {
        if (unsubscribeRef.current) {
            unsubscribeRef.current();
            unsubscribeRef.current = null;
        }
        const listner = await createListenerAsync<Document<Data>>(
            firestore,
            queryClient,
            path,
        );
        unsubscribeRef.current = listner.unsubscribe;
        return listner.initialData;
    }

    const {data, status, error, refetch} = useQuery<
        Document<Data>,
        Error,
        TransData
    >(path || "", fetch, {
        ...options,
        enabled: !!path && options?.enabled,
        notifyOnChangeProps: "tracked",
    });

    const set = useCallback(
        (
            newData: Partial<AllowType<Data, FieldValue>>,
            setOptions?: SetOptions,
        ) => {
            if (!path) return;
            return firestore.doc(path).set(newData, setOptions || {});
        },
        [path, firestore],
    );

    const update = useCallback(
        (newData: Partial<AllowType<Data, FieldValue>>) => {
            if (!path) return;
            return firestore.doc(path).update(newData);
        },
        [path, firestore],
    );

    const deleteDocument = useCallback(() => {
        return deleteDoc(path);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [path]);

    const setCache = useCallback(
        (cachedData: Partial<Document<Data>>) => {
            if (!path) return;
            const newData = queryClient.setQueryData<Partial<Document<Data>>>(
                path,
                (prevState) => {
                    return {
                        ...prevState,
                        ...cachedData,
                    };
                },
            );
            updateCollectionCache(queryClient, path, newData.id || "", newData);
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [path],
    );

    return {
        data,
        status,
        error,
        set,
        update,
        deleteDocument,
        refetch,
        setCache,
        unsubscribe: unsubscribeRef.current,
    };
};
