import type { CSSProperties, ReactNode } from 'react';

type CardProps = {
  title?: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
};

export function Card({ title, children, className, style }: CardProps) {
  return (
    <section className={className ? `card ${className}` : 'card'} style={style}>
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  );
}
