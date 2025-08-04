
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

export function findEmailInText(text: string | null) {
    if (!text) return null;
    const emailMatches = EMAIL_REGEX.exec(text);
    if (!emailMatches) return null;
    const email = emailMatches[0].trim().toLowerCase();
    return email.length > 0 && email.length < 256 ? email : null;
}
