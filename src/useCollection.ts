import {useCallback, useEffect, useMemo, useRef} from "react";
import {QueryClient, useQuery, useQueryClient} from "react-query";
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
) =>
    // { isCollectionGroup = false }: { isCollectionGroup?: boolean } = empty.object
    {
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
                        ref = ref.orderBy(
                            order as string | FieldPath,
                            direction,
                        );
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
    path: string,
    queryString: string,
): Promise<ListenerReturnType<Doc>> => {
    return new Promise((resolve) => {
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
                    } as any;
                    // update individual docs in the cache
                    queryClient.setQueryData(doc.ref.path, docToAdd);
                    data.push(docToAdd);
                });
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
    Data extends Record<string, unknown>,
    TransData = Document<Data>,
>(
    path: string,
    options?: Options<Document<Data>[], TransData>,
    query?: CollectionQueryType,
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
        // __unstableCollectionGroup: isCollectionGroup = false,
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

    async function fetch() {
        const {unsubscribe, initialData} = await createListenerAsync<
            Document<Data>
        >(firestore, queryClient, path, memoQueryString);
        unsubscribeRef.current = unsubscribe;
        return initialData;
    }

    const {data, status, error} = useQuery<Document<Data>[], Error, TransData>(
        [path, memoQueryString],
        fetch,
        {
            ...options,
            notifyOnChangeProps: "tracked",
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
     * `add(data)`: Extends the Firestore document [`add` function](https://firebase.google.com/docs/firestore/manage-data/add-data).
     * - It also updates the local cache using react-query's `setQueryData`. This will prove highly convenient over the regular `add` function provided by Firestore.
     */
    const add = useCallback(
        (newData: Data | Data[]) => {
            if (!path) return null;

            const dataArray = Array.isArray(newData) ? newData : [newData];

            const ref = firestore.collection(path);

            const docsToAdd: Document<Data>[] = dataArray.map((doc) => ({
                ...doc,
                // generate IDs we can use that in the local cache that match the server
                id: ref.doc().id,
            })) as Document<Data>[];

            // add to network
            const batch = firestore.batch();

            docsToAdd.forEach(({id, ...doc}) => {
                // take the ID out of the document
                batch.set(ref.doc(id), doc);
            });

            return batch.commit();
        },
        [path, firestore],
    );

    return {
        data,
        status,
        error,
        add,
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
