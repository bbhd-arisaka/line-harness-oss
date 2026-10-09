// App Store 審査用のデモの友だち。LINE ユーザーIDが「Udemo」で始まる友だちには、LINE へは送らない
// (実在しない相手なので、送ると LINE がエラーを返し、審査担当の「返信してみる」操作が失敗してしまう)。
export const isDemoLineUserId = (lineUserId: string | null | undefined): boolean => typeof lineUserId === 'string' && lineUserId.startsWith('Udemo');
