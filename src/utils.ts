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
