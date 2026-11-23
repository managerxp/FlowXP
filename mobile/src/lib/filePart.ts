/* A picked picture as a part of a multipart upload. The app's fetch (Expo's) refuses the old {uri, name, type} object ("Unsupported FormData part implementation"); it wants a real File. */
export const filePart = async (uri: string): Promise<Blob> => {
  const { File } = await import('expo-file-system');
  return new File(uri) as unknown as Blob;
};
