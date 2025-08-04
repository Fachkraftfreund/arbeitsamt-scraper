

export function cleanPhoneNumber(phoneNumber: string | null): string | null {
    if (!phoneNumber) return null;
    phoneNumber = phoneNumber.replace(/\s/g, '');
    phoneNumber = phoneNumber.replace(/^\+49/g, '0');
    phoneNumber = phoneNumber.replace(/^0049/g, '0');
    phoneNumber = phoneNumber.replace(/^\+43/g, '0043');
    phoneNumber = phoneNumber.replace(/^0043/g, '0043');
    phoneNumber = phoneNumber.replace(/^\+41/g, '0041');
    phoneNumber = phoneNumber.replace(/^0041/g, '0041');
    return phoneNumber;
}

export function findPhoneNumberInText(text: string | null): string | null {
    if (!text) return null;
    const phoneRegex = /(\+49|0049|\+43|0043|\+41|0041|0)\s*[1-9][0-9\s\/\-\(\)]{4,}/g;
    const matches = text.match(phoneRegex);
    if (!matches || matches.length === 0) return null;
    const cleanedNumbers = matches.map(cleanPhoneNumber).filter(num => num !== null);
    return cleanedNumbers.length > 0 ? cleanedNumbers[0] : null;
}