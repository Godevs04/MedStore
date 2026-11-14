import { ImageResponse } from 'next/og';

export const alt = 'MediCore: batch-level inventory, GST-ready billing, compliance built in';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          color: '#fff',
          backgroundColor: '#123B3A',
          backgroundImage: 'radial-gradient(circle at 100% 0%, rgba(20,184,166,0.38), rgba(18,59,58,0) 60%)',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', fontSize: 40, fontWeight: 700 }}>
          <span>Medi</span>
          <span style={{ color: '#5FD8C4' }}>Core</span>
          <span style={{ marginLeft: 20, fontSize: 18, letterSpacing: 6, opacity: 0.75 }}>PHARMACY ERP</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: 78, fontWeight: 700, lineHeight: 1.1 }}>
          <span>Batch-level inventory.</span>
          <span style={{ color: '#A7EBDD' }}>GST-ready billing.</span>
          <span>Compliance built in.</span>
        </div>
        <div style={{ fontSize: 28, opacity: 0.8 }}>Pharmacy software for India · 14-day free trial</div>
      </div>
    ),
    size,
  );
}
