import {useEffect, useMemo, useState} from "react";
import {useInfiniteCollection} from "react-query-firestore";

interface Post {
    id: string;
    text: string;
    createdAt: any;
}

export const useInfinitePosts = () => {
    const [isMounted, setIsMounted] = useState(false);

    const {data, status, add, fetchNextPage, hasNextPage, isFetchingNextPage} =
        useInfiniteCollection<Post>(
            isMounted ? "posts" : undefined,
            {},
            {
                orderBy: ["createdAt", "desc"],
                limit: 10,
            },
        );

    useEffect(() => {
        setIsMounted(true);
    }, []);

    const posts = useMemo(
        () =>
            data
                ? data.map(({text, id, createdAt, __snapshot}) => {
                      return {
                          text,
                          id,
                          createdAt: createdAt.toDate?.(),
                          __snapshot,
                      };
                  })
                : [],
        [data],
    );

    return {
        posts,
        status,
        addPost: add,
        isLoading: status === "loading",
        paginate: fetchNextPage,
        hasMore: hasNextPage,
        isFetchingMore: isFetchingNextPage,
    };
};
