import React from 'react'
import { Box, Text } from '../ink.js'

const C = {
  WHITE: '#D6D8DA',
  GREY: '#8F969F',
  DARK_GREY: '#5F6971',
  BLUE: '#1E8AFD',
  RED: '#FA0000',
} as const

function color(ch: string): string | undefined {
  switch (ch) {
    // En terminal oscuro NO conviene usar negro,
    // porque se pierde el logo. El @ debe verse claro.
    case '@':
    case '%':
      return C.WHITE

    // Sombras / pelaje
    case '*':
      return C.GREY

    case '+':
    case '-':
    case '=':
    case ':':
      return C.DARK_GREY

    // Moño / parte roja inferior
    case '#':
      return C.RED

    default:
      return undefined
  }
}

type Span = {
  col?: string
  txt: string
}

function spans(line: string): Span[] {
  const out: Span[] = []
  let cur: Span | null = null

  for (const ch of line) {
    const col = color(ch)

    if (cur && cur.col === col) {
      cur.txt += ch
    } else {
      if (cur) out.push(cur)
      cur = { col, txt: ch }
    }
  }

  if (cur) out.push(cur)
  return out
}

const ROWS = [
  '      @@@                      @@@',
  '   @@@@*@@@@                @@@@*@@@@',
  '  @@@@  *@@@+              %@@@*  @@@@',
  ' @@@%*-   @@@@            @@@@   -**@@@',
  ' @@@@ ----***@@@@@@@@@@@@@@***---- @@@@',
  ' @@@@ -----+***@@@@@@@@@@***++---- @@@@',
  ' @@@@ ----********************---- @@@@',
  ' @@@@******************************@@@@',
  ' @@@@******************************@@@@',
  '@@@@********   **********   ********@@@@',
  '@@********@@@@@ ******** @@@@@********@@',
  '@@*******-@@@@@@********@@@@@@-*******@@',
  '@@***** --@@@@@@%*******@@@@@@-- *****@@',
  '@@**       ---##        ##---       **@@',
  '@@*:             @@@@@@             -*@@',
  '@@*==           @@@@@@@@           =+*@@',
  '@@@===       @  @@@@@@@@  @       ===*@@',
  ' @@@==-     @@@@@@@@@@@@@@@@     -==@@@',
  '  @@@=*=-     @@@@@@@@@@@@     -=*=@@@',
  '   @@@**@@@@@@            @@@@@@**@@@',
  '    @@@@@@##@@@          @@@##@@@@@@',
  '      @@@@#####@@@@@@@@@@#####@@@@',
  '       @@@######@@@##@@@######@@@',
  '       @@@######@@@@@@@@######@@@',
  '       @@@####@@@@@@@@@@@@####@@@',
  '        *@@@@@@@@       @@@@@@@@',
]

const WIDTH = Math.max(...ROWS.map(row => row.length))
const RENDERED = ROWS.map(row => spans(row.padEnd(WIDTH, ' ')))

export function ClaudexASCIILogo(): React.ReactNode {
  return (
    <Box flexDirection="column" flexShrink={0}>
      {RENDERED.map((row, ri) => (
        <Box key={ri} flexDirection="row" flexShrink={0}>
          {row.map((s, si) => (
            <Text key={si} color={s.col}>
              {s.txt}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  )
}
