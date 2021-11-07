import React from "react";
import {QueryClient, QueryClientProvider, DefaultOptions} from "react-query";
import {persistQueryClient} from "react-query/persistQueryClient-experimental";
import {createAsyncStoragePersistor} from "react-query/createAsyncStoragePersistor-experimental";
import {FirebaseFirestore} from "@firebase/firestore-types";
import stringify from "fast-safe-stringify";

import {Storage} from "./types";

function createCtx<A extends unknown | null>() {
    const ctx = React.createContext<A | undefined>(undefined);
    function useCtx() {
        const c = React.useContext(ctx);
        if (c === undefined)
            throw new Error("useCtx must be inside a Provider with a value");
        return c;
    }
    return [useCtx, ctx.Provider] as const; // 'as const' makes TypeScript infer a tuple
}

interface FirestoreContextProps {
    firestore: FirebaseFirestore;
}
const [useFirestore, FirestoreProvider] = createCtx<FirestoreContextProps>();

interface ProviderProps {
    reactQueryConfig?: DefaultOptions;
    firestore: FirebaseFirestore;
}

const queryClient = new QueryClient();
const enablePersistence = (storage: Storage) => {
    const asyncStoragePersistor = createAsyncStoragePersistor({
        storage,
        serialize: stringify,
    });

    persistQueryClient({
        queryClient,
        persistor: asyncStoragePersistor,
    });
};

const ReactQueryFirestoreProvider = ({
    children,
    reactQueryConfig,
    firestore,
}: React.PropsWithChildren<ProviderProps>) => {
    queryClient.setDefaultOptions(reactQueryConfig || {});
    return (
        <FirestoreProvider value={{firestore}}>
            <QueryClientProvider client={queryClient}>
                {children}
            </QueryClientProvider>
        </FirestoreProvider>
    );
};

export {useFirestore, ReactQueryFirestoreProvider, enablePersistence};
