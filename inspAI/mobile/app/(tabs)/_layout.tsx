import { NativeTabs, Icon, Label } from 'expo-router/unstable-native-tabs';
import { ThemeProvider, DefaultTheme } from '@react-navigation/native';

export default function TabLayout() {
  return (
    <ThemeProvider value={DefaultTheme}>
      <NativeTabs disableTransparentOnScrollEdge>
        <NativeTabs.Trigger name="index">
          <Label>Home</Label>
          <Icon sf="house.fill" md="home" />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="explore">
          <Label>Reports</Label>
          <Icon sf="doc.text.fill" md="description" />
        </NativeTabs.Trigger>
      </NativeTabs>
    </ThemeProvider>
  );
}
