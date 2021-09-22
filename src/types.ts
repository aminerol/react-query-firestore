import {UseQueryOptions, UseInfiniteQueryOptions} from "react-query";
import {
    FieldPath,
    WhereFilterOp,
    QueryDocumentSnapshot,
} from "@firebase/firestore-types";

export const empty = {
    object: {},
    array: [],
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    function: () => {},
};

export type AllowType<O extends unknown, Allowed> = {
    [K in keyof O]: O[K] | Allowed;
};

export type Document<T = unknown> = T & {
    id: string;
    exists?: boolean;
    hasPendingWrites?: boolean;
    __snapshot?: QueryDocumentSnapshot;
};

export type Options<Doc, TData> = UseQueryOptions<Doc, Error, TData>;

export type InfiniteOptions<Doc, TData> = UseInfiniteQueryOptions<
    Doc,
    Error,
    TData
>;

export type ListenerReturnType<Doc extends Document = Document> = {
    initialData: Doc;
    unsubscribe: () => void;
};

// Collection Types

export type Collections = {
    [path: string]: {
        key: [string, string | undefined]; // [path, queryString]
    }[];
};

type KeyHack = string & Record<string, unknown>; // hack to also allow strings

// here we get the "key" from our data, to add intellisense for any "orderBy" in the queries and such.
export type OrderByArray<Doc extends Document = Document, Key = keyof Doc> = [
    Key | FieldPath | KeyHack,
    "asc" | "desc",
];
export type OrderByItem<Doc extends Document = Document, Key = keyof Doc> =
    | OrderByArray<Doc>
    | Key
    | KeyHack;
export type OrderByType<Doc extends Document = Document> =
    | OrderByItem<Doc>
    | OrderByArray<Doc>[];

export type WhereItem<Doc extends Document = Document, Key = keyof Doc> = [
    Key | FieldPath | KeyHack,
    WhereFilterOp,
    unknown,
];
export type WhereArray<Doc extends Document = Document> = WhereItem<Doc>[];
export type WhereType<Doc extends Document = Document> =
    | WhereItem<Doc>
    | WhereArray<Doc>;

export type CollectionQueryType<Doc extends Document = Document> = {
    limit?: number;
    orderBy?: OrderByType<Doc>;
    where?: WhereType<Doc>;
    isCollectionGroup?: boolean;

    /**
     * For now, this can only be a number, since it has to be JSON serializable.
     *
     * **TODO** allow DocumentSnapshot here too. This will probably be used with a useStaticCollection hook in the future.
     */
    startAt?: number;
    /**
     * For now, this can only be a number, since it has to be JSON serializable.
     *
     * **TODO** allow DocumentSnapshot here too. This will probably be used with a useStaticCollection hook in the future.
     */
    endAt?: number;
    /**
     * For now, this can only be a number, since it has to be JSON serializable.
     *
     * **TODO** allow DocumentSnapshot here too. This will probably be used with a useStaticCollection hook in the future.
     */
    startAfter?: number;
    /**
     * For now, this can only be a number, since it has to be JSON serializable.
     *
     * **TODO** allow DocumentSnapshot here too. This will probably be used with a useStaticCollection hook in the future.
     */
    endBefore?: number;

    // THESE ARE NOT JSON SERIALIZABLE
    // startAt?: number | DocumentSnapshot
    // endAt?: number | DocumentSnapshot
    // startAfter?: number | DocumentSnapshot
    // endBefore?: number | DocumentSnapshot
};
