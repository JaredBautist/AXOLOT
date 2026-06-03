import React from 'react'
import { Box, Text } from '../../ink.js'

type Props = {
  compact?: boolean
}

const BODY = '#000000'
const FUR = '#5F6971'
const EYE = '#1E8AFD'
const BOW = '#FA0000'

/**
 * Compact husky face with red bow, rendered in 4 rows.
 * Designed to replace the Clawd mascot in the LogoV2 layout.
 */
export function ClaudexHusky({ compact }: Props): React.ReactNode {
  if (compact) {
    return (
      <Text color={BODY}>
        <Text color={EYE}>●</Text>
        <Text> </Text>
        <Text color={BOW}>♥</Text>
      </Text>
    )
  }

  return (
    <Box flexDirection="column" alignItems="center">
      <Text>
        <Text color={BODY}> </Text>
        <Text color={BODY}>▗</Text>
        <Text color={FUR}>▄</Text>
        <Text color={FUR}>▄</Text>
        <Text color={FUR}>▄</Text>
        <Text color={FUR}>▄</Text>
        <Text color={BODY}>▖</Text>
      </Text>
      <Text>
        <Text color={BODY}>▐</Text>
        <Text color={BODY}>▙</Text>
        <Text color={FUR}> </Text>
        <Text color={EYE}>█</Text>
        <Text color={FUR}> </Text>
        <Text color={EYE}>█</Text>
        <Text color={FUR}> </Text>
        <Text color={BODY}>▟</Text>
        <Text color={BODY}>▌</Text>
      </Text>
      <Text>
        <Text color={BODY}>▐</Text>
        <Text color={FUR}>█</Text>
        <Text color={BODY}>▄</Text>
        <Text color={FUR}> </Text>
        <Text color={FUR}> </Text>
        <Text color={FUR}> </Text>
        <Text color={BODY}>▄</Text>
        <Text color={FUR}>█</Text>
        <Text color={BODY}>▌</Text>
      </Text>
      <Text>
        <Text color={BODY}> </Text>
        <Text color={BOW}>▝</Text>
        <Text color={BOW}>▜</Text>
        <Text color={BOW}>█</Text>
        <Text color={BOW}>█</Text>
        <Text color={BOW}>█</Text>
        <Text color={BOW}>▛</Text>
        <Text color={BOW}>▘</Text>
      </Text>
    </Box>
  )
}
