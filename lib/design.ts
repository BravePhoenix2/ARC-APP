export const articColors = {
  background: '#F2F1F4',
  surface: '#FFFFFF',
  indigoDark: '#362A67',
  indigoDarker: '#2B2260',
  purple: '#7C74C4',
  lavender: '#AFA8D3',
  pinkAccent: '#EF476F',
  pinkSoft: '#F49BC5',
  greyBlock: '#C9C7CD',
} as const;

export const articFonts = {
  heading: 'Poppins, sans-serif',
  body: 'Poppins, sans-serif',
} as const;

export const articShadow = {
  soft: '0 8px 18px rgba(54, 42, 103, 0.08)',
  minimal: '0 4px 10px rgba(54, 42, 103, 0.06)',
} as const;

export const articRadius = {
  sm: '6px',
  md: '10px',
  lg: '16px',
} as const;

export const articButtonStyles = {
  primary:
    'inline-flex items-center justify-center rounded-[6px] bg-[#EF476F] px-5 py-3 font-semibold text-white transition hover:bg-[#d93d63] focus:outline-none',
  secondary:
    'inline-flex items-center justify-center rounded-[6px] border border-[#362A67] bg-transparent px-5 py-3 font-semibold text-[#362A67] transition hover:bg-[#362A67] hover:text-white focus:outline-none',
} as const;
