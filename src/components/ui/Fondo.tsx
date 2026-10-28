/**
 * Fondo fijo de la app: cielo nocturno, aurora verde-agua y la cordillera con
 * un volcan nevado sobre un fiordo con balsas-jaula (dibujado, sin foto ni
 * JavaScript). Hermano del fondo del buscador de precios (Torres y lago bajo
 * una nebulosa violeta), pero con paisaje y luz propios para no confundirlas.
 * Se pinta una vez; estrellas y aurora se animan solo con CSS (globals.css).
 */
const ESTRELLAS: [number, number, number][] = [
  [40, 70, 1.1], [120, 30, 1.4], [190, 140, 0.8], [270, 55, 1.2], [340, 190, 0.9], [410, 25, 1.5], [480, 120, 0.8],
  [560, 60, 1.2], [620, 200, 0.9], [700, 95, 1.4], [760, 20, 0.9], [830, 150, 1.1], [900, 45, 1.3], [970, 175, 0.8],
  [1040, 85, 1.5], [1110, 30, 0.9], [1180, 135, 1.2], [1250, 65, 0.8], [1320, 180, 1.1], [1410, 40, 1.3],
  [70, 250, 0.8], [230, 280, 1], [520, 265, 0.8], [760, 250, 0.9], [1080, 270, 1], [1290, 245, 0.8], [1420, 230, 0.9],
];

/** Balsas-jaula del centro de cultivo: dos filas de anillos sobre el agua. */
const BALSAS: [number, number][] = [
  [470, 808], [530, 808], [590, 808], [650, 808], [710, 808],
  [440, 836], [500, 836], [560, 836], [620, 836], [680, 836], [740, 836],
];

export function Fondo() {
  return (
    <div aria-hidden="true" className="fondo">
      <div className="fondo-aurora" />
      <svg width="100%" height="100%" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMax slice">
        <g fill="#ffffff" className="fondo-estrellas">
          {ESTRELLAS.map(([x, y, r]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r={r} />
          ))}
        </g>
        {/* Cordillera lejana con el volcan y su cono nevado */}
        <polygon
          fill="#143246"
          opacity="0.95"
          points="0,610 120,560 230,590 340,520 430,560 540,500 640,540 720,500 800,410 818,404 836,410 905,500 990,520 1080,490 1150,505 1180,470 1200,466 1220,476 1300,515 1440,490 1440,900 0,900"
        />
        <polygon fill="#e6f4f2" opacity="0.6" points="800,410 818,404 836,410 852,436 840,431 828,440 816,430 804,438 788,433" />
        <polygon fill="#e6f4f2" opacity="0.35" points="1180,470 1200,466 1220,476 1212,481 1200,476 1188,482" />
        {/* Cordillera cercana */}
        <polygon fill="#0b2130" points="0,700 140,650 280,690 420,630 560,680 700,640 860,690 1000,620 1150,670 1300,630 1440,665 1440,900 0,900" />
        {/* Fiordo, con el reflejo del cielo en la orilla */}
        <rect x="0" y="760" width="1440" height="140" fill="#06141f" />
        <rect x="0" y="760" width="1440" height="2" fill="#4fc3b4" opacity="0.25" />
        <g fill="none" stroke="#4fc3b4" strokeWidth="1.5" opacity="0.4">
          {BALSAS.map(([x, y]) => (
            <ellipse key={`${x}-${y}`} cx={x} cy={y} rx="22" ry="5" />
          ))}
        </g>
        {/* Ponton de alimentacion con su luz */}
        <rect x="790" y="812" width="46" height="12" rx="2" fill="#10293a" />
        <rect x="800" y="802" width="20" height="10" rx="1" fill="#10293a" />
        <circle cx="810" cy="806" r="1.6" fill="#f3d58a" className="fondo-luz" />
      </svg>
    </div>
  );
}
