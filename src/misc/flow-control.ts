
export async function waitUntil<T>(condition: () => Promise<T>, timeout = 10000): Promise<T> {
    {
        const result = await condition();
        if (result) return Promise.resolve(result);
    }
    {
        const maxTime = Date.now() + timeout;
        return new Promise((resolve, reject) => {
            const interval = setInterval(async () => {
                if (Date.now() > maxTime) {
                    clearInterval(interval);
                    reject(`waitUntil timed out for ${condition}`);
                }
                const result = await condition();
                if (!result) return;
                clearInterval(interval);
                resolve(result);
            }, 25);
        });
    }
}
