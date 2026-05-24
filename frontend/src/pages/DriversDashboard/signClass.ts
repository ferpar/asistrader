import shared from './shared.module.css'

/** Returns the CSS class that colors a value green / red / neutral by sign. */
export function signClass(value: number): string {
  if (value > 0) return shared.pos
  if (value < 0) return shared.neg
  return ''
}
