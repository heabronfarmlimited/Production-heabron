/**
 * `_LocationPicker` — extracted from add_farmer_view.dart /
 * edit_farmer_view.dart, where it was declared privately in both.
 *
 * Label `'Farm Location (GPS)'`, two decimal fields hinted `Latitude` and
 * `Longitude`, and a filled primary button that fills them from the device
 * GPS (`IconButton.filled(Icons.my_location)`).
 *
 * FIXED — the Dart fields had no validators and the controller sent `0.0` for
 * a blank coordinate, storing every unmapped farm at 0°N 0°E. Both fields are
 * validated against the Joi bounds (±90 / ±180) and omitted from the body when
 * blank; see `farmerFormSchema`.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppLoading } from '../../../components/AppLoading';
import { AppTextField } from '../../../components/AppTextField';
import { useLocation } from '../../../core/hooks/useLocation';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';

export interface LocationPickerProps {
  latitude: string;
  longitude: string;
  onChange: (coords: { latitude: string; longitude: string }) => void;
  latitudeError?: string;
  longitudeError?: string;
  title?: string;
  enabled?: boolean;
}

export function LocationPicker({
  latitude,
  longitude,
  onChange,
  latitudeError,
  longitudeError,
  title = 'Farm Location (GPS)',
  enabled = true,
}: LocationPickerProps) {
  const { fetchLocation, loading } = useLocation();

  const useCurrentLocation = async () => {
    const coords = await fetchLocation();
    if (!coords) return;
    onChange({
      latitude: String(coords.latitude),
      longitude: String(coords.longitude),
    });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>

      <View style={{ height: h(8) }} />

      <View style={styles.row}>
        <View style={styles.field}>
          <AppTextField
            hintText="Latitude"
            keyboardType="numbers-and-punctuation"
            value={latitude}
            onChangeText={(text) => onChange({ latitude: text, longitude })}
            error={latitudeError}
            enabled={enabled}
            testID="farm-latitude"
          />
        </View>

        <View style={{ width: r(12) }} />

        <View style={styles.field}>
          <AppTextField
            hintText="Longitude"
            keyboardType="numbers-and-punctuation"
            value={longitude}
            onChangeText={(text) => onChange({ latitude, longitude: text })}
            error={longitudeError}
            enabled={enabled}
            testID="farm-longitude"
          />
        </View>

        <View style={{ width: r(12) }} />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Use my current location"
          accessibilityState={{ busy: loading, disabled: !enabled }}
          disabled={!enabled || loading}
          onPress={useCurrentLocation}
          style={styles.locateButton}
          testID="farm-locate"
        >
          {loading ? (
            <AppLoading color={colors.white} />
          ) : (
            <Text accessible={false} style={styles.locateGlyph}>
              ◎
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
  },
  title: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  field: {
    flex: 1,
  },
  locateButton: {
    width: r(52),
    height: r(52),
    borderRadius: r(12),
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locateGlyph: {
    color: colors.white,
    fontSize: spMin(22),
  },
});
