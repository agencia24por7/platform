import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';

export const runtime = 'nodejs';
export const alt = 'orla — um oceano azul para seus anúncios';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  const logo = await readFile(join(process.cwd(), 'public', 'orla', 'logo-reversa.png'));
  const logoSrc = `data:image/png;base64,${logo.toString('base64')}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          padding: 80,
          background: 'linear-gradient(158deg, #072a4a 0%, #0a3a63 42%, #0e4f87 76%, #1468b0 100%)',
        }}
      >
        <img src={logoSrc} width={360} height={138} alt="" />
        <div style={{ marginTop: 32, fontSize: 42, color: '#eaf4ff', maxWidth: 860, display: 'flex' }}>
          Um oceano azul para seus anúncios.
        </div>
      </div>
    ),
    { ...size },
  );
}
