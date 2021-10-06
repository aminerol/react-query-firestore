import {useEffect, useMemo, useRef} from "react";
import {
    QueryClient,
    useInfiniteQuery,
    useMutation,
    useQueryClient,
} from "react-query";
import {
    DocumentData,
    FieldPath,
    FirebaseFirestore,
    Query,
    QueryDocumentSnapshot,
} from "@firebase/firestore-types";

import {useFirestore} from "./Provider";
import {collectionCache} from "./Cache";
import {
    CollectionQueryType,
    Document,
    empty,
    InfiniteOptions,
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
    response: {
        data: Doc[];
        lastDoc?: QueryDocumentSnapshot<DocumentData>;
    };
    unsubscribe: () => void;
};

const createListenerAsync = async <Doc extends Document = Document>(
    firestore: FirebaseFirestore,
    queryClient: QueryClient,
    path: string | undefined = undefined,
    queryString: string,
    pageParam: any,
): Promise<ListenerReturnType<Doc>> => {
    return new Promise((resolve, reject) => {
        if (!path) {
            return resolve({
                response: {
                    data: [],
                },
                unsubscribe: empty.function,
            });
        }
        const query: CollectionQueryType = JSON.parse(queryString) ?? {};
        let ref = createFirestoreRef(firestore, path, query);
        if (pageParam) {
            ref = ref.startAfter(pageParam);
        }
        const unsubscribe = ref.onSnapshot(
            {includeMetadataChanges: false},
            {
                next: (querySnapshot) => {
                    const data: Doc[] = [];

                    querySnapshot.forEach((doc) => {
                        const docData = doc.data() ?? empty.object;
                        const docToAdd = {
                            ...docData,
                            id: doc.id,
                            exists: doc.exists,
                            hasPendingWrites: doc.metadata.hasPendingWrites,
                            __snapshot: doc,
                        } as Doc;
                        // update individual docs in the cache
                        queryClient.setQueryData(doc.ref.path, docToAdd);
                        data.push(docToAdd);
                    });

                    resolve({
                        response: {
                            data,
                            lastDoc: data[data.length - 1]?.__snapshot,
                        },
                        unsubscribe,
                    });
                },
                error: reject,
            },
        );
    });
};

/**
 * Call a Firestore Collection
 * @template Doc
 * @param path String if the document is ready. If it's not ready yet, pass `undefined`, and the request won't start yet.
 * @param [options] - takes any of useQuery options.
 * @param [query] - Dictionary with options to query the collection.
 */
export const useInfiniteCollection = <Data, TransData extends Data = Data>(
    path?: string,
    options?: InfiniteOptions<
        {data: Document<Data>[]; lastDoc?: QueryDocumentSnapshot<DocumentData>},
        {data: Document<TransData>}
    >,
    query?: CollectionQueryType<Document<Data>>,
) => {
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

    async function fetch({pageParam}: any) {
        if (unsubscribeRef.current) {
            unsubscribeRef.current();
            unsubscribeRef.current = null;
        }
        const {unsubscribe, response} = await createListenerAsync<
            Document<Data>
        >(firestore, queryClient, path, memoQueryString, pageParam);
        unsubscribeRef.current = unsubscribe;
        return response;
    }

    const {
        data,
        status,
        error,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
    } = useInfiniteQuery<
        {data: Document<Data>[]; lastDoc?: QueryDocumentSnapshot<DocumentData>},
        Error,
        {data: Document<TransData>}
    >([path, memoQueryString], fetch, {
        ...options,
        notifyOnChangeProps: "tracked",
        getNextPageParam: (lastPage) => {
            return lastPage.lastDoc;
        },
    });

    const {mutateAsync} = useMutation<
        Document<Data>[],
        Error,
        {data: Data | Data[]; subPath?: string},
        {previousPages: any}
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
            // When mutate is called:
            // onMutate: async ({data}) => {
            //     const dataArray = Array.isArray(data) ? data : [data];
            //     // Cancel any outgoing refetches (so they don't overwrite our optimistic update)
            //     await queryClient.cancelQueries([path, memoQueryString]);

            //     // Snapshot the previous value
            //     const previousPages = queryClient.getQueryData([
            //         path,
            //         memoQueryString,
            //     ]);

            //     // Optimistically update to the new value
            //     queryClient.setQueryData<{
            //         pages: {
            //             data: Document<Data>[];
            //             lastDoc?: QueryDocumentSnapshot<DocumentData>;
            //         }[];
            //         pageParams: any;
            //     }>([path, memoQueryString], (resp) => {
            //         if (!resp) return resp as any;

            //         const newPagesArray = resp.pages.map((page, index) => {
            //             return index === resp.pages.length - 1
            //                 ? {
            //                       data: [...dataArray, ...page.data],
            //                       lastDoc: page.lastDoc,
            //                   }
            //                 : page;
            //         });
            //         return {pages: newPagesArray, pageParams: resp.pageParams};
            //     });

            //     // Return a context object with the snapshotted value
            //     return {previousPages};
            // },

            // // If the mutation fails, use the context returned from onMutate to roll back
            // onError: (_, __, context) => {
            //     queryClient.setQueryData(
            //         [path, memoQueryString],
            //         context?.previousPages,
            //     );
            // },

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

    const formattedData = useMemo(() => {
        return data?.pages.map((page) => page.data).flat();
    }, [data]);

    return {
        data: formattedData,
        status,
        error,
        add,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
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
