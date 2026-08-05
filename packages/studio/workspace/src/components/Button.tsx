import * as React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'destructive';
}

export function Button({ variant = 'primary', className, ...props }: ButtonProps) {
  const base = 'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm';
  const variants = {
    primary: 'bg-primary text-primary-foreground',
    ghost: 'bg-transparent hover:bg-accent',
    destructive: 'bg-destructive text-destructive-foreground',
  };
  return <button className={`${base} ${variants[variant]} ${className ?? ''}`} {...props} />;
}
