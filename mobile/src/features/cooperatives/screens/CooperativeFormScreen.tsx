/**
 * The shared body of `CreateCooperativeView` and `EditCooperativeView`.
 *
 * The two Dart screens were a 269-line and a 300-line copy of each other,
 * differing only in the heading (`'Add Cooperative'` / `'Edit Cooperative'`),
 * the button (`'Create Cooperative'` / `'Update Cooperative'`), whether the
 * fields were prefilled, and the edit screen's two defects (a hidden
 * `CropTypeSelector` and `'null'` in the GPS inputs). One component takes both.
 *
 * Dart field order, preserved: Cooperative name, Registration number,
 * State / LGA, Address, Crop type, Estimated land size, Latitude + Longitude
 * side by side, 'Get My Location', the logo target, then the submit button.
 *
 * FIXED — both screens rendered dead `Text('Select State')` and
 * `Text('Select LGA')` labels directly above `StateLgaDropdown`, which renders
 * its own 'State' and 'Local Government Area' titles. Removed, as in
 * `PersonalInfoStep`.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '../../../components/AppButton';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { AppTextField } from '../../../components/AppTextField';
import { AppBackButton } from '../../../components/BaseAppBar';
import { StateLgaDropdown } from '../../../components/StateLgaDropdown';
import { useLocation } from '../../../core/hooks/useLocation';
import { useImageField } from '../../../core/hooks/useMediaPicker';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { applyServerFieldErrors } from '../../../core/utils/serverFieldErrors';
import { CropTypeSelector } from '../components/CropTypeSelector';
import { LogoUploadCard } from '../components/LogoUploadCard';
import { cooperativeFormSchema, type CooperativeForm } from '../model/validation';

/** Fields the backend can reject by name — see `createCooperative`. */
const SERVER_FIELDS = [
  'name',
  'registrationNumber',
  'state',
  'lga',
  'address',
  'estimatedLandSize',
  'gpsLat',
  'gpsLng',
  'logoUrl',
] as const;

export interface CooperativeFormScreenProps {
  heading: string;
  submitLabel: string;
  defaultValues: CooperativeForm;
  /** Existing logo on the edit form. */
  initialLogoUrl?: string | null;
  submitting: boolean;
  /** Blocks the form while the record is still loading (edit only). */
  loading?: boolean;
  onSubmit: (
    values: CooperativeForm,
    handlers: { onError: (err: unknown) => void },
  ) => void;
}

export function CooperativeFormScreen({
  heading,
  submitLabel,
  defaultValues,
  initialLogoUrl,
  submitting,
  loading = false,
  onSubmit,
}: CooperativeFormScreenProps) {
  const {
    control,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors },
  } = useForm<CooperativeForm>({
    resolver: zodResolver(cooperativeFormSchema),
    // Dart: AutovalidateMode.onUserInteraction
    mode: 'onTouched',
    defaultValues,
  });

  /**
   * FIXED — Flutter uploaded the cooperative logo as `avatar`, which the
   * backend routes to the **private** `agent-documents` bucket, so the saved
   * URL was not publicly readable and the logo could not render for anyone
   * without a signed URL. `cooperative_logo` is the correct kind and maps to
   * the public `partner-logos` bucket. See `BUCKETS` in uploads.controller.js.
   */
  const logo = useImageField(
    'cooperative_logo',
    initialLogoUrl ?? defaultValues.logoUrl,
  );
  const { fetchLocation, loading: locating } = useLocation();

  const state = watch('state');
  const lga = watch('lga');

  /**
   * FIXED — Dart's "Get My Location" wrote `position.latitude.toString()`
   * straight to the controller, bypassing the two-decimal input formatter, so
   * a fetched coordinate had full precision while a typed one was truncated to
   * about a kilometre. There is no truncation now, in either path.
   */
  const captureLocation = async () => {
    const coords = await fetchLocation();
    if (!coords) return;
    setValue('gpsLat', String(coords.latitude), { shouldValidate: true });
    setValue('gpsLng', String(coords.longitude), { shouldValidate: true });
  };

  const submit = (values: CooperativeForm) => {
    onSubmit(
      // The uploaded URL lives in `useImageField`, not the form.
      { ...values, logoUrl: logo.url ?? '' },
      {
        onError: (err) => {
          applyServerFieldErrors(err, setError, SERVER_FIELDS);
        },
      },
    );
  };

  return (
    <AppSkeleton isBusy={loading} scrollable>
      <AppBackButton />

      <View style={{ height: h(14) }} />

      <Text style={styles.heading}>{heading}</Text>

      <View style={{ height: h(28) }} />

      <Controller
        control={control}
        name="name"
        render={({ field }) => (
          <AppTextField
            title="Cooperative name"
            hintText="Hamsel industries"
            autoCapitalize="words"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.name?.message}
            testID="cooperative-name"
          />
        )}
      />

      <View style={{ height: h(20) }} />

      <Controller
        control={control}
        name="registrationNumber"
        render={({ field }) => (
          <AppTextField
            title="Registration number"
            hintText="RC123456"
            autoCapitalize="characters"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.registrationNumber?.message}
            testID="cooperative-registration"
          />
        )}
      />

      <View style={{ height: h(20) }} />

      {/*
        FIXED — the edit form left both of these blank, with a comment in the
        controller admitting it could not prefill them, so every edit forced
        the agent to re-pick their state and LGA. `defaultValues` carries them.
      */}
      <StateLgaDropdown
        state={state}
        lga={lga}
        onStateChange={(next) => setValue('state', next, { shouldValidate: true })}
        onLgaChange={(next) => setValue('lga', next, { shouldValidate: true })}
        stateError={errors.state?.message}
        lgaError={errors.lga?.message}
      />

      <View style={{ height: h(20) }} />

      <Controller
        control={control}
        name="address"
        render={({ field }) => (
          <AppTextField
            title="Address"
            hintText="123 Farm Road"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.address?.message}
            testID="cooperative-address"
          />
        )}
      />

      <View style={{ height: h(20) }} />

      <Controller
        control={control}
        name="cropsSupported"
        render={({ field }) => (
          <CropTypeSelector
            value={field.value}
            onChange={field.onChange}
            error={errors.cropsSupported?.message}
          />
        )}
      />

      <View style={{ height: h(20) }} />

      <Controller
        control={control}
        name="estimatedLandSize"
        render={({ field }) => (
          <AppTextField
            title="Estimated land size in acres"
            hintText="Enter land size in acres"
            keyboardType="decimal-pad"
            value={field.value}
            // Decimals are kept: the validator is `Joi.number().min(0)`, and
            // the Dart form parsed this with `int.tryParse`, turning 4.5 into 0.
            onChangeText={(text) => field.onChange(text.replace(/[^0-9.]/g, ''))}
            onBlur={field.onBlur}
            error={errors.estimatedLandSize?.message}
            testID="cooperative-land-size"
          />
        )}
      />

      <View style={{ height: h(20) }} />

      <View style={styles.coordRow}>
        <View style={styles.coord}>
          <Controller
            control={control}
            name="gpsLat"
            render={({ field }) => (
              <AppTextField
                title="Latitude"
                hintText="Latitude"
                keyboardType="numbers-and-punctuation"
                value={field.value}
                // A leading '-' is allowed — the Dart formatter rejected it,
                // which made southern latitudes impossible to type.
                onChangeText={(text) => field.onChange(sanitiseCoordinate(text))}
                onBlur={field.onBlur}
                error={errors.gpsLat?.message}
                testID="cooperative-latitude"
              />
            )}
          />
        </View>

        <View style={{ width: r(12) }} />

        <View style={styles.coord}>
          <Controller
            control={control}
            name="gpsLng"
            render={({ field }) => (
              <AppTextField
                title="Longitude"
                hintText="Longitude"
                keyboardType="numbers-and-punctuation"
                value={field.value}
                onChangeText={(text) => field.onChange(sanitiseCoordinate(text))}
                onBlur={field.onBlur}
                error={errors.gpsLng?.message}
                testID="cooperative-longitude"
              />
            )}
          />
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy: locating }}
        onPress={captureLocation}
        disabled={locating}
        style={styles.locationButton}
        hitSlop={6}
      >
        <Text style={styles.locationGlyph}>📍</Text>
        <Text style={styles.locationLabel}>
          {locating ? 'Getting your location…' : 'Get My Location'}
        </Text>
      </Pressable>

      <View style={{ height: h(20) }} />

      <LogoUploadCard
        previewUri={logo.previewUri}
        uploading={logo.uploading}
        onPress={logo.chooseFromLibrary}
      />

      <View style={{ height: h(28) }} />

      <AppButton
        text={submitLabel}
        height={54}
        loading={submitting}
        disabled={logo.uploading}
        onPress={handleSubmit(submit)}
        testID="cooperative-submit"
      />

      <View style={{ height: h(24) }} />
    </AppSkeleton>
  );
}

/**
 * Keeps digits, a single leading minus and a single decimal point.
 *
 * This replaces `FilteringTextInputFormatter.allow(RegExp(r'^\d+\.?\d{0,2}'))`,
 * which blocked the minus sign outright and capped the fraction at two digits.
 */
function sanitiseCoordinate(text: string): string {
  const negative = text.trimStart().startsWith('-');
  const digits = text.replace(/[^0-9.]/g, '');
  const [whole = '', ...rest] = digits.split('.');
  const fraction = rest.join('');
  const body = rest.length > 0 ? `${whole}.${fraction}` : whole;
  return negative ? `-${body}` : body;
}

const styles = StyleSheet.create({
  heading: {
    ...textTheme.headlineMedium,
    fontSize: spMin(22),
    fontFamily: fontWeights.bold,
    fontWeight: '700',
  },
  coordRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  coord: {
    flex: 1,
  },
  locationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingVertical: r(8),
  },
  locationGlyph: {
    fontSize: spMin(16),
    marginRight: r(6),
  },
  locationLabel: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    color: colors.primary,
  },
});
