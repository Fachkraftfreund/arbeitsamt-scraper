
export function groupBy<T, K extends string | number>(array: T[], getGroup: (item: T, index: number) => K): Record<K, T[]> {
    return array.reduce((result, item, index) => {
        const groupKey = getGroup(item, index);
        if (!result[groupKey]) 
            result[groupKey] = [];
        result[groupKey].push(item);
        return result;
    }, {} as Record<K, T[]>);
}