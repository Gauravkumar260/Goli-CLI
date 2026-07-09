/**
 * components/WelcomeTip.tsx — Welcome row + tier-color legend (memoized).
 */
import React from 'react';
import { Text } from 'ink';
import { T } from '../theme/tokens.js';

interface Props {
  /** When false, render only the compact tip (no welcome heading). */
  showWelcome: boolean;
}

function WelcomeTipImpl({ showWelcome }: Props): React.ReactElement {
  return (
    <>
      {showWelcome && (
        <Text>
          Welcome to <Text color={T.teal} bold>Goli-CLI</Text>! Type your message or{' '}
          <Text color={T.blue}>/help</Text> for commands.
        </Text>
      )}
      <Text color={T.gray}>
        <Text color={T.yellow}>✦</Text> Tip:{' '}
        <Text color={T.blue}>/godmode</Text> = BLK autonomy.{'  '}
        <Text color={T.teal}>T0</Text>=read{' '}
        <Text color={T.green}>T1</Text>=write{' '}
        <Text color={T.yellow}>T2</Text>=exec{' '}
        <Text color={T.orange}>T3</Text>=net{' '}
        <Text color={T.red}>BLK</Text>=all
      </Text>
    </>
  );
}

/**
 *
 */
export const WelcomeTip = React.memo(WelcomeTipImpl);
