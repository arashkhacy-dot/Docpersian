declare module 'arabic-persian-reshaper' {
  export interface PersianShaperType {
    convertArabic(text: string): string;
    convertArabicBack(text: string): string;
  }
  export interface ArabicShaperType {
    convertArabic(text: string): string;
    convertArabicBack(text: string): string;
  }
  export const PersianShaper: PersianShaperType;
  export const ArabicShaper: ArabicShaperType;
  const def: { PersianShaper: PersianShaperType; ArabicShaper: ArabicShaperType };
  export default def;
}
