import React from 'react'
import { Box, Text } from '../ink.js'

const C = {
  BODY: '#F3A0A8',
  BODY_LIGHT: '#FFD0D4',
  SHADOW: '#E86B8F',
  OUTLINE: '#C94F7C',
  BLUSH: '#FF6F79',
  FACE: '#2D1719',
} as const

function isFacePixel(row: number, col: number): boolean {
  return (
    (row === 11 && ((col >= 19 && col <= 21) || (col >= 32 && col <= 34))) ||
    (row === 12 && col >= 24 && col <= 29)
  )
}

function color(ch: string, row: number, col: number): string | undefined {
  if (isFacePixel(row, col)) return C.FACE

  switch (ch) {
    // Cuerpo principal del ajolote.
    case '-':
    case '%':
      return C.BODY

    // Luces suaves para panza/zonas claras.
    case '#':
      return C.BODY_LIGHT

    // Sombras y volumen.
    case '=':
    case '*':
    case '+':
      return C.SHADOW

    // Contorno oscuro, legible en terminal claro y oscuro.
    case ':':
      return C.OUTLINE

    // Mejillas, branquias o acentos rosados fuertes.
    case '@':
      return C.BLUSH

    default:
      return undefined
  }
}

type Span = {
  col?: string
  txt: string
}

function spans(line: string, rowIndex: number): Span[] {
  const out: Span[] = []
  let cur: Span | null = null

  for (let colIndex = 0; colIndex < line.length; colIndex++) {
    const ch = line[colIndex]!
    const col = color(ch, rowIndex, colIndex)
    const txt = col ? (ch === ':' ? ':' : ch === '#' ? '%' : '#') : ' '

    if (cur && cur.col === col) {
      cur.txt += txt
    } else {
      if (cur) out.push(cur)
      cur = { col, txt }
    }
  }

  if (cur) out.push(cur)
  return out
}

const ROWS = [
  ' ..................................................,',
  '+.................................................,',
  '%...........--....................................,',
  '..........:%===%%....................:#%%#%-......,',
  '..........=%=====%:....:=+*+=:......%%=====%......,',
  '........::.#%=====%%%+--------=*%%=%======%-......,',
  '......:%===*%%*==------------------=====%%*##-....,',
  '......:%=======----------------------%%#=====##...,',
  '........%%====------------------------=======%-...,',
  '.......+%%%%%+-------------------------=*%%%-.....,',
  '......%======--------------------------=++*%%=....,',
  '......+%*==+*=-----%%%----------%%%----======%:...,',
  '.............%--===+#---*%**%+--*%+==--%%%%%%-....,',
  '.......-*+....%#-------------------=--%...........,',
  '.....%%--=%...:%%%*----------------*%-............,',
  '...:%---=-%.:%-----------------=%=:...............,',
  '...%---==-+%#-------------------%:................,',
  '...%----=-+%-------=----%--------%................,',
  '...%------%--------##---%---=#---%................,',
  '...-%-----%---------*%#%#----%%+*%................,',
  '....:%*----%---------------=%-.............:#+%:..,',
  '.......+%%%%%-----#*==+*%%*#+...............%%%%*.,',
  '.............%%--*%....*%=#%..................%...,',
  '...............:-.................................,',
]

const WIDTH = Math.max(...ROWS.map(row => row.length))
const RENDERED = ROWS.map((row, ri) => spans(row.padEnd(WIDTH, ' '), ri))

export function AxolotASCIILogo(): React.ReactNode {
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
