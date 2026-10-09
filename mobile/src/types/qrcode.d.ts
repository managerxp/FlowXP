declare module 'qrcode' {
  const QRCode: { create: (text: string, options?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' }) => { modules: { size: number; data: ArrayLike<number> } } };
  export default QRCode;
}
