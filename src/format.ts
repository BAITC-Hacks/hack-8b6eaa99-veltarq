export function number(value: number, digits = 3) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value);
}

export function delta(value: number, digits = 3) {
  return `${value > 0 ? '+' : ''}${number(value, digits)}`;
}
