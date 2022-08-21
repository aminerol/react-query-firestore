import {DocumentData} from "@firebase/firestore-types";

export function parseDates(obj: DocumentData) {
    const keys = Object.keys(obj);
    keys.forEach(function (key) {
        const value = obj[key];
        if (!value) return value;
        if (
            typeof value === "object" &&
            "seconds" in value &&
            "nanoseconds" in value
        ) {
            obj[key] = value.toDate();
        } else if (typeof value === "object") {
            parseDates(obj[key]);
        }
    });
}

export function unionBy<T>(arr1: T[], arr2: T[], iteratee: (item: T) => any) {
    const set = new Set(arr1.map(iteratee));
    return Array.from(
        new Set([...arr1, ...arr2.filter((itm) => !set.has(iteratee(itm)))]),
    );
}
