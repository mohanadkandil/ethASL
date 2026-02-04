import { NativeTabs, Icon, Label } from 'expo-router/unstable-native-tabs';
import { ThemeProvider, DefaultTheme } from '@react-navigation/native';

export default function TabLayout() {
  return (
    <ThemeProvider value={DefaultTheme}>
      <NativeTabs disableTransparentOnScrollEdge>
        <NativeTabs.Trigger name="index">
          <Label>Chat</Label>
          <Icon sf="bubble.left.fill" md="chat" />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="explore">
          <Label>Settings</Label>
          <Icon sf="gearshape.fill" md="settings" />
        </NativeTabs.Trigger>
      </NativeTabs>
    </ThemeProvider>
  );
}
