import Big from 'big.js'

export class Decimal {
  private readonly value: Big

  constructor(value: number | string | Decimal) {
    if (value instanceof Decimal) {
      this.value = new Big(value.value)
    } else {
      this.value = new Big(value)
    }
  }

  private static wrap(big: Big): Decimal {
    const d = Object.create(Decimal.prototype) as Decimal
    ;(d as unknown as { value: Big }).value = big
    return d
  }

  static from(value: number | string | Decimal): Decimal {
    return new Decimal(value)
  }

  static zero(): Decimal {
    return new Decimal(0)
  }

  plus(other: Decimal): Decimal {
    return Decimal.wrap(this.value.plus(other.value))
  }

  minus(other: Decimal): Decimal {
    return Decimal.wrap(this.value.minus(other.value))
  }

  times(other: Decimal): Decimal {
    return Decimal.wrap(this.value.times(other.value))
  }

  div(other: Decimal): Decimal {
    return Decimal.wrap(this.value.div(other.value))
  }

  abs(): Decimal {
    return Decimal.wrap(this.value.abs())
  }

  neg(): Decimal {
    return Decimal.wrap(this.value.times(-1))
  }

  sqrt(): Decimal {
    return Decimal.wrap(this.value.sqrt())
  }

  pow(n: number): Decimal {
    return Decimal.wrap(this.value.pow(n))
  }

  eq(other: Decimal): boolean {
    return this.value.eq(other.value)
  }

  gt(other: Decimal): boolean {
    return this.value.gt(other.value)
  }

  gte(other: Decimal): boolean {
    return this.value.gte(other.value)
  }

  lt(other: Decimal): boolean {
    return this.value.lt(other.value)
  }

  lte(other: Decimal): boolean {
    return this.value.lte(other.value)
  }

  isZero(): boolean {
    return this.value.eq(0)
  }

  isPositive(): boolean {
    return this.value.gt(0)
  }

  isNegative(): boolean {
    return this.value.lt(0)
  }

  toNumber(): number {
    return this.value.toNumber()
  }

  toFixed(dp?: number): string {
    return dp !== undefined ? this.value.toFixed(dp) : this.value.toFixed()
  }

  toString(): string {
    return this.value.toString()
  }
}
