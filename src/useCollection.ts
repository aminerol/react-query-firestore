import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {QueryClient, useMutation, useQuery, useQueryClient} from "react-query";
import {FieldPath, FirebaseFirestore, Query} from "@firebase/firestore-types";

import {useFirestore} from "./Provider";
import {collectionCache} from "./Cache";
import {
    CollectionQueryType,
    Document,
    empty,
    Options,
    OrderByArray,
    OrderByType,
    WhereArray,
    WhereType,
} from "./types";

const createFirestoreRef = (
    firestore: FirebaseFirestore,
    path: string,
    {
        where,
        orderBy,
        limit,
        startAt,
        endAt,
        startAfter,
        endBefore,
        isCollectionGroup,
    }: CollectionQueryType,
) => {
    let ref: Query = firestore.collection(path);

    if (isCollectionGroup) {
        ref = firestore.collectionGroup(path);
    }

    if (where) {
        function multipleConditions(w: WhereType): w is WhereArray {
            return !!(w as WhereArray) && Array.isArray(w[0]);
        }
        if (multipleConditions(where)) {
            where.forEach((w) => {
                ref = ref.where(w[0] as string | FieldPath, w[1], w[2]);
            });
        } else if (
            typeof where[0] === "string" &&
            typeof where[1] === "string"
        ) {
            ref = ref.where(where[0], where[1], where[2]);
        }
    }

    if (orderBy) {
        if (typeof orderBy === "string") {
            ref = ref.orderBy(orderBy);
        } else if (Array.isArray(orderBy)) {
            function multipleOrderBy(o: OrderByType): o is OrderByArray[] {
                return Array.isArray((o as OrderByArray[])[0]);
            }
            if (multipleOrderBy(orderBy)) {
                orderBy.forEach(([order, direction]) => {
                    ref = ref.orderBy(order as string | FieldPath, direction);
                });
            } else {
                const [order, direction] = orderBy;
                ref = ref.orderBy(order as string | FieldPath, direction);
            }
        }
    }

    if (startAt) {
        ref = ref.startAt(startAt);
    }

    if (endAt) {
        ref = ref.endAt(endAt);
    }

    if (startAfter) {
        ref = ref.startAfter(startAfter);
    }

    if (endBefore) {
        ref = ref.endBefore(endBefore);
    }

    if (limit) {
        ref = ref.limit(limit);
    }

    return ref;
};

type ListenerReturnType<Doc extends Document = Document> = {
    initialData: Doc[];
    unsubscribe: () => void;
};

const createListenerAsync = async <Doc extends Document = Document>(
    firestore: FirebaseFirestore,
    queryClient: QueryClient,
    path: string | undefined = undefined,
    queryString: string,
    ignoreFirestoreDocumentSnapshotField: boolean,
    setHasNextPage: (value: boolean) => void,
): Promise<ListenerReturnType<Doc>> => {
    return new Promise((resolve) => {
        if (!path) {
            return resolve({
                initialData: [],
                unsubscribe: empty.function,
            });
        }
        const query: CollectionQueryType = JSON.parse(queryString) ?? {};
        const ref = createFirestoreRef(firestore, path, query);
        const unsubscribe = ref.onSnapshot(
            {includeMetadataChanges: true},
            (querySnapshot) => {
                const data: Doc[] = [];

                querySnapshot.forEach((doc) => {
                    const docData = doc.data() ?? empty.object;
                    const docToAdd = {
                        ...docData,
                        id: doc.id,
                        exists: doc.exists,
                        hasPendingWrites: doc.metadata.hasPendingWrites,
                        __snapshot: ignoreFirestoreDocumentSnapshotField
                            ? undefined
                            : doc,
                    } as Doc;
                    // update individual docs in the cache
                    queryClient.setQueryData(doc.ref.path, docToAdd);
                    data.push(docToAdd);
                });

                setHasNextPage(!querySnapshot.empty);

                // resolve initial data
                resolve({
                    initialData: data,
                    unsubscribe,
                });
                // update on listener fire
                queryClient.setQueryData([path, queryString], data);
            },
        );
    });
};

/**
 * Call a Firestore Collection
 * @template Doc
 * @param path String if the document is ready. If it's not ready yet, pass `null`, and the request won't start yet.
 * @param [query] - Dictionary with options to query the collection.
 * @param [options] - takes any of useQuery options.
 */
export const useCollection = <
    Data,
    TransData extends Document<Data> = Document<Data>,
>(
    path?: string,
    options?: Options<Document<Data>[], TransData[]>,
    query?: CollectionQueryType<Document<Data>> & {
        ignoreFirestoreDocumentSnapshotField?: boolean;
    },
) => {
    const [isFetchingNextPage, setIsFetchingNextPage] = useState(false);
    const [hasNextPage, setHasNextPage] = useState(true);
    const {firestore} = useFirestore();
    const queryClient = useQueryClient();
    const unsubscribeRef = useRef<ListenerReturnType["unsubscribe"] | null>(
        null,
    );

    const {
        where,
        endAt,
        endBefore,
        startAfter,
        startAt,
        orderBy,
        limit,
        isCollectionGroup,
        ignoreFirestoreDocumentSnapshotField = true,
    } = query || {};

    // why not just put this into the ref directly?
    // so that we can use the useEffect down below that triggers revalidate()
    const memoQueryString = useMemo(
        () =>
            JSON.stringify({
                where,
                endAt,
                endBefore,
                startAfter,
                startAt,
                orderBy,
                limit,
                isCollectionGroup,
            }),
        [
            endAt,
            endBefore,
            isCollectionGroup,
            limit,
            orderBy,
            startAfter,
            startAt,
            where,
        ],
    );

    async function fetch() {
        if (unsubscribeRef.current) {
            unsubscribeRef.current();
            unsubscribeRef.current = null;
        }
        const {unsubscribe, initialData} = await createListenerAsync<
            Document<Data>
        >(
            firestore,
            queryClient,
            path,
            memoQueryString,
            ignoreFirestoreDocumentSnapshotField,
            setHasNextPage,
        );
        unsubscribeRef.current = unsubscribe;
        return initialData;
    }

    const {data, status, error} = useQuery<
        Document<Data>[],
        Error,
        TransData[]
    >([path, memoQueryString], fetch, {
        ...options,
        notifyOnChangeProps: "tracked",
    });

    const {mutateAsync} = useMutation<
        Document<Data>[],
        Error,
        {data: Data | Data[]; subPath?: string}
    >(
        async ({data: newData, subPath}) => {
            if (!path) return Promise.resolve([]);
            const newPath = subPath ? path + "/" + subPath : path;
            const dataArray = Array.isArray(newData) ? newData : [newData];

            const ref = firestore.collection(newPath);
            const docsToAdd: Document<Data>[] = dataArray.map((doc) => ({
                ...doc,
                // generate IDs we can use that in the local cache that match the server
                id: ref.doc().id,
            }));

            // add to network
            const batch = firestore.batch();

            docsToAdd.forEach(({id, ...doc}) => {
                // take the ID out of the document
                batch.set(ref.doc(id), doc);
            });

            await batch.commit();

            return Promise.resolve(docsToAdd);
        },
        {
            // Always refetch after error or success:
            onSettled: () => {
                queryClient.invalidateQueries([path, memoQueryString]);
            },
        },
    );

    useEffect(() => {
        //should it go before the useQuery?
        return () => {
            // clean up listener on unmount if it exists
            if (unsubscribeRef.current) {
                unsubscribeRef.current();
                unsubscribeRef.current = null;
            }
        };
        // should depend on the path, queyr being the same...
    }, [path, memoQueryString]);

    // add the collection to the cache,
    // so that we can mutate it from document calls later
    useEffect(() => {
        if (path) collectionCache.addCollectionToCache(path, memoQueryString);
    }, [path, memoQueryString]);

    /**
     * `add(data, subPath?)`: Extends the Firestore document [`add` function](https://firebase.google.com/docs/firestore/manage-data/add-data).
     * - It also updates the local cache using react-query's `setQueryData`. This will prove highly convenient over the regular `add` function provided by Firestore.
     * - If the second argument is defined it will be concatinated to path arg as a prefix
     */
    const add = async (newData: Data | Data[], subPath?: string) =>
        mutateAsync({data: newData, subPath});

    const setCache = useCallback(
        (cachedData: TransData[]) => {
            queryClient.setQueryData<TransData[]>(
                [path, memoQueryString],
                (prevState) => {
                    if (!prevState) return [];
                    return [...prevState, ...cachedData];
                },
            );
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [path, memoQueryString],
    );

    const fetchNextPage = async () => {
        if (!path || !data?.length) return;

        setIsFetchingNextPage(true);

        // get the snapshot of last document we have right now in our query
        const startAfterDocument = data[data.length - 1].__snapshot;
        const ref = createFirestoreRef(
            firestore,
            path,
            JSON.parse(memoQueryString),
        );

        // get more documents, after the most recent one we have
        const querySnapshot = await ref.startAfter(startAfterDocument).get();
        setHasNextPage(!querySnapshot.empty);
        const moreDocs: TransData[] = [];
        querySnapshot.docs.forEach((doc) => {
            const docData = doc.data() ?? empty.object;
            const docToAdd = {
                ...docData,
                id: doc.id,
                exists: doc.exists,
                hasPendingWrites: doc.metadata.hasPendingWrites,
                __snapshot: ignoreFirestoreDocumentSnapshotField
                    ? undefined
                    : doc,
            } as TransData;
            // update individual docs in the cache
            queryClient.setQueryData(doc.ref.path, docToAdd);
            moreDocs.push(docToAdd);
        });

        // mutate our local cache, adding the docs we just added
        setCache(moreDocs);

        setIsFetchingNextPage(false);
    };

    return {
        data,
        status,
        error,
        add,
        setCache,
        fetchNextPage,
        isFetchingNextPage,
        hasNextPage,
        /**
         * A function that, when called, unsubscribes the Firestore listener.
         *
         * The function can be null, so make sure to check that it exists before calling it.
         *
         * Note: This is not necessary to use. `useCollection` already unmounts the listener for you. This is only intended if you want to unsubscribe on your own.
         */
        unsubscribe: unsubscribeRef.current,
    };
};
