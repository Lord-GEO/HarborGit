const light = new URL('../../assets/idea-rollback.svg', import.meta.url).href;
const dark = new URL('../../assets/idea-rollback-dark.svg', import.meta.url).href;

// JetBrains Apache-2.0 icon assets; attribution is included with the application.
export function RollbackIcon({ size = 16 }: { size?: number }) {
  return <span className="rollback-icon" aria-hidden="true" style={{ width: size, height: size }}>
    <img className="rollback-icon-light" src={light} alt="" width={size} height={size} draggable={false} />
    <img className="rollback-icon-dark" src={dark} alt="" width={size} height={size} draggable={false} />
  </span>;
}
