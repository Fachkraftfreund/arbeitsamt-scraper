
export async function exponentialBackoff<T>(
    fn: () => Promise<T>,
    maxRetries = 3,
    delay = 500,
): Promise<T> {
    let attempt = 0;
    let error: any;
    while (attempt < maxRetries) {
        try {
            return await fn();
        } catch (err) {
            error = err;
            if (attempt === maxRetries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, attempt)));
            attempt++;
        }
    }
    throw error;
}