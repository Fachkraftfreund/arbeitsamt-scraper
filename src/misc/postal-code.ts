
export function getPostalCodeFromAddress(address: string | null | undefined): number | null {
    const postalCode = address?.match(/\d{5}/);
    if (!postalCode) return null;
    return parseInt(postalCode[0], 10);
}