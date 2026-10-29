/**
 * The three shared sections of the farmer form — 'Personal Information',
 * 'Farm Profile' and 'Uploads'.
 *
 * add_farmer_view.dart (720 LOC) and edit_farmer_view.dart (798 LOC) were
 * near-duplicates: the same 27 fields in the same order, differing only in the
 * heading, the subtitle, the button label, four missing validators and three
 * fields laid out side by side. All of that is props here, so a label only
 * exists once.
 *
 * Every label, hint and option list is verbatim from the audit; every dropdown
 * sends `domainConstants` values, never the display label.
 */
import {
  Controller,
  type Control,
  type FieldErrors,
  type UseFormSetValue,
} from 'react-hook-form';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { AppDropdown } from '../../../components/AppDropdown';
import { AppTextField } from '../../../components/AppTextField';
import { DateField } from '../../../components/DateField';
import { StateLgaDropdown } from '../../../components/StateLgaDropdown';
import {
  CROPS,
  GENDERS,
  LAND_OWNERSHIPS,
  SOIL_TYPES,
  WATER_SOURCES,
} from '../../../core/api/domainConstants';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import type { FarmerForm } from '../model/validation';

import { CropTypeSelector } from './CropTypeSelector';
import { LocationPicker } from './LocationPicker';
import { SectionTitle } from './SectionTitle';
import { MultiUploadCard, UploadCard } from './UploadCard';

/** The upload fields a farmer form owns, as returned by `useImageField`. */
export interface ImageFieldState {
  previewUri: string | null;
  url: string | null;
  uploading: boolean;
  hasValue: boolean;
  chooseFromLibrary: () => Promise<void>;
  clear: () => void;
}

export interface ImageListFieldState {
  urls: string[];
  pending: { uri: string }[];
  uploading: boolean;
  count: number;
  add: () => Promise<void>;
  removeAt: (index: number) => void;
}

export interface FarmerFormSectionProps {
  control: Control<FarmerForm>;
  errors: FieldErrors<FarmerForm>;
  setValue: UseFormSetValue<FarmerForm>;
  /** Watched values the dependent controls need. */
  values: Pick<
    FarmerForm,
    'state' | 'lga' | 'gender' | 'cropType' | 'secondaryCrops' | 'gpsLat' | 'gpsLng'
  >;
  /** Edit screen packs NIN/BVN, Soil/Years and Water/Irrigation side by side. */
  compact?: boolean;
  enabled?: boolean;
}

/** `initialDate: DateTime(now.year - 18)`, `lastDate: DateTime(now.year - 18)`. */
function eighteenYearsAgo(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 18);
  return d;
}

const Gap = ({ size = 16 }: { size?: number }) => <View style={{ height: h(size) }} />;

// ------------------------------------------------- Personal Information
export function PersonalInformationSection({
  control,
  errors,
  setValue,
  values,
  compact = false,
  enabled = true,
}: FarmerFormSectionProps) {
  return (
    <View>
      <SectionTitle title="Personal Information" />
      <Gap />

      <Controller
        control={control}
        name="fullName"
        render={({ field }) => (
          <AppTextField
            title="Full Name"
            hintText="e.g. John Doe"
            autoCapitalize="words"
            enabled={enabled}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.fullName?.message}
            testID="farmer-full-name"
          />
        )}
      />

      <Gap />

      {/* Dart laid Date of Birth and Gender side by side on both screens. */}
      <View style={styles.row}>
        <View style={styles.cell}>
          <Controller
            control={control}
            name="dateOfBirth"
            render={({ field }) => (
              <DateField
                title="Date of Birth"
                hintText="YYYY-MM-DD"
                enabled={enabled}
                value={field.value}
                onChange={field.onChange}
                error={errors.dateOfBirth?.message}
                initialDate={eighteenYearsAgo()}
                minimumDate={new Date(1900, 0, 1)}
                maximumDate={eighteenYearsAgo()}
                testID="farmer-dob"
              />
            )}
          />
        </View>

        <View style={{ width: r(12) }} />

        <View style={styles.cell}>
          <AppDropdown
            title="Gender"
            label="Select Gender"
            options={GENDERS}
            value={values.gender}
            enabled={enabled}
            error={errors.gender?.message}
            onChange={(next) => setValue('gender', next, { shouldValidate: true })}
            testID="farmer-gender"
          />
        </View>
      </View>

      <Gap />

      <Controller
        control={control}
        name="phone"
        render={({ field }) => (
          <AppTextField
            title="Phone Number"
            hintText="080..."
            keyboardType="phone-pad"
            maxLength={11}
            enabled={enabled}
            value={field.value}
            // Dart: FilteringTextInputFormatter.digitsOnly
            onChangeText={(t) => field.onChange(t.replace(/\D/g, ''))}
            onBlur={field.onBlur}
            error={errors.phone?.message}
            testID="farmer-phone"
          />
        )}
      />

      <Gap />

      <Controller
        control={control}
        name="altPhone"
        render={({ field }) => (
          <AppTextField
            title="Alt. Phone"
            hintText="Optional"
            keyboardType="phone-pad"
            maxLength={11}
            enabled={enabled}
            value={field.value}
            onChangeText={(t) => field.onChange(t.replace(/\D/g, ''))}
            onBlur={field.onBlur}
            error={errors.altPhone?.message}
            testID="farmer-alt-phone"
          />
        )}
      />

      <Gap />

      {compact ? (
        <View style={styles.row}>
          <View style={styles.cell}>
            <NinField control={control} errors={errors} enabled={enabled} />
          </View>
          <View style={{ width: r(12) }} />
          <View style={styles.cell}>
            <BvnField control={control} errors={errors} enabled={enabled} />
          </View>
        </View>
      ) : (
        <>
          <NinField control={control} errors={errors} enabled={enabled} />
          <Gap />
          <BvnField control={control} errors={errors} enabled={enabled} />
        </>
      )}

      <Gap />

      <Controller
        control={control}
        name="educationLevel"
        render={({ field }) => (
          <AppTextField
            title="Education Level"
            hintText="e.g. B.Sc, SSCE"
            enabled={enabled}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.educationLevel?.message}
            testID="farmer-education"
          />
        )}
      />

      <Gap />

      <View style={styles.row}>
        <View style={styles.cell}>
          <Controller
            control={control}
            name="householdSize"
            render={({ field }) => (
              <AppTextField
                title="Household Size"
                hintText="0"
                keyboardType="number-pad"
                enabled={enabled}
                value={field.value}
                onChangeText={(t) => field.onChange(t.replace(/\D/g, ''))}
                onBlur={field.onBlur}
                error={errors.householdSize?.message}
                testID="farmer-household-size"
              />
            )}
          />
        </View>

        <View style={{ width: r(12) }} />

        <View style={styles.cell}>
          <Controller
            control={control}
            name="dependents"
            render={({ field }) => (
              <AppTextField
                title="Dependents"
                hintText="0"
                keyboardType="number-pad"
                enabled={enabled}
                value={field.value}
                onChangeText={(t) => field.onChange(t.replace(/\D/g, ''))}
                onBlur={field.onBlur}
                error={errors.dependents?.message}
                testID="farmer-dependents"
              />
            )}
          />
        </View>
      </View>

      <Gap />

      <Controller
        control={control}
        name="address"
        render={({ field }) => (
          <AppTextField
            title="Residential Address"
            hintText="House number, street name..."
            enabled={enabled}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.address?.message}
            testID="farmer-address"
          />
        )}
      />

      <Gap />

      {/*
        NOTE — both Dart screens rendered stray `Text('Select State')` and
        `Text('Select LGA')` labels directly above StateLgaDropdown, which
        renders its own 'State' and 'Local Government Area' titles, so every
        label appeared twice. Removed.
      */}
      <StateLgaDropdown
        state={values.state}
        lga={values.lga}
        enabled={enabled}
        onStateChange={(next) => setValue('state', next, { shouldValidate: true })}
        onLgaChange={(next) => setValue('lga', next, { shouldValidate: true })}
        stateError={errors.state?.message}
        lgaError={errors.lga?.message}
      />
    </View>
  );
}

function NinField({
  control,
  errors,
  enabled,
}: Pick<FarmerFormSectionProps, 'control' | 'errors'> & { enabled: boolean }) {
  return (
    <Controller
      control={control}
      name="nin"
      render={({ field }) => (
        <AppTextField
          title="NIN"
          hintText="11 digits"
          keyboardType="number-pad"
          maxLength={11}
          enabled={enabled}
          value={field.value}
          onChangeText={(t) => field.onChange(t.replace(/\D/g, ''))}
          onBlur={field.onBlur}
          error={errors.nin?.message}
          testID="farmer-nin"
        />
      )}
    />
  );
}

function BvnField({
  control,
  errors,
  enabled,
}: Pick<FarmerFormSectionProps, 'control' | 'errors'> & { enabled: boolean }) {
  return (
    <Controller
      control={control}
      name="bvn"
      render={({ field }) => (
        <AppTextField
          title="BVN"
          hintText="11 digits"
          keyboardType="number-pad"
          maxLength={11}
          enabled={enabled}
          value={field.value}
          onChangeText={(t) => field.onChange(t.replace(/\D/g, ''))}
          onBlur={field.onBlur}
          error={errors.bvn?.message}
          testID="farmer-bvn"
        />
      )}
    />
  );
}

// -------------------------------------------------------- Farm Profile
export function FarmProfileSection({
  control,
  errors,
  setValue,
  values,
  compact = false,
  enabled = true,
}: FarmerFormSectionProps) {
  return (
    <View>
      <SectionTitle title="Farm Profile" />
      <Gap />

      <Controller
        control={control}
        name="farmSizeAcres"
        render={({ field }) => (
          <AppTextField
            title="Farm Size (Acres)"
            hintText="0.0"
            keyboardType="decimal-pad"
            enabled={enabled}
            value={field.value}
            onChangeText={(t) => field.onChange(t.replace(/[^0-9.]/g, ''))}
            onBlur={field.onBlur}
            error={errors.farmSizeAcres?.message}
            testID="farmer-farm-size"
          />
        )}
      />

      <Gap />

      <AppDropdown
        title="Primary Crop"
        label="Select Crop"
        options={CROPS}
        value={values.cropType}
        enabled={enabled}
        error={errors.cropType?.message}
        onChange={(next) => {
          setValue('cropType', next, { shouldValidate: true });
          // Keep the primary crop out of the secondary list.
          setValue(
            'secondaryCrops',
            values.secondaryCrops.filter((crop) => crop !== next),
            { shouldValidate: true },
          );
        }}
        testID="farmer-primary-crop"
      />

      <Gap />

      <Text style={styles.fieldLabel}>Secondary Crops</Text>
      <Gap size={8} />
      <Controller
        control={control}
        name="secondaryCrops"
        render={({ field }) => (
          <CropTypeSelector
            value={field.value}
            onChange={field.onChange}
            exclude={values.cropType ? [values.cropType] : []}
            enabled={enabled}
            error={errors.secondaryCrops?.message}
          />
        )}
      />

      <Gap size={20} />

      {compact ? (
        <View style={styles.row}>
          <View style={styles.cell}>
            <SoilTypeField
              error={errors.soilType?.message}
              enabled={enabled}
              control={control}
            />
          </View>
          <View style={{ width: r(12) }} />
          <View style={styles.cell}>
            <YearsExperienceField
              control={control}
              error={errors.yearsExperience?.message}
              enabled={enabled}
            />
          </View>
        </View>
      ) : (
        <>
          <SoilTypeField
            error={errors.soilType?.message}
            enabled={enabled}
            control={control}
          />
          <Gap />
          <YearsExperienceField
            control={control}
            error={errors.yearsExperience?.message}
            enabled={enabled}
          />
        </>
      )}

      <Gap />

      {compact ? (
        <View style={styles.row}>
          <View style={styles.cell}>
            <WaterSourceField
              control={control}
              error={errors.waterSource?.message}
              enabled={enabled}
            />
          </View>
          <View style={{ width: r(24) }} />
          <View style={styles.cell}>
            <IrrigationField control={control} enabled={enabled} />
          </View>
        </View>
      ) : (
        <>
          <WaterSourceField
            control={control}
            error={errors.waterSource?.message}
            enabled={enabled}
          />
          <Gap />
          <IrrigationField control={control} enabled={enabled} />
        </>
      )}

      <Gap />

      <Controller
        control={control}
        name="landOwnership"
        render={({ field }) => (
          <AppDropdown
            title="Land Ownership"
            label="Select Ownership"
            options={LAND_OWNERSHIPS}
            value={field.value}
            enabled={enabled}
            error={errors.landOwnership?.message}
            onChange={field.onChange}
            testID="farmer-land-ownership"
          />
        )}
      />

      <Gap />

      <LocationPicker
        latitude={values.gpsLat}
        longitude={values.gpsLng}
        enabled={enabled}
        latitudeError={errors.gpsLat?.message}
        longitudeError={errors.gpsLng?.message}
        onChange={({ latitude, longitude }) => {
          setValue('gpsLat', latitude, { shouldValidate: true });
          setValue('gpsLng', longitude, { shouldValidate: true });
        }}
      />
    </View>
  );
}

function SoilTypeField({
  control,
  error,
  enabled,
}: {
  control: Control<FarmerForm>;
  error?: string;
  enabled: boolean;
}) {
  return (
    <Controller
      control={control}
      name="soilType"
      render={({ field }) => (
        <AppDropdown
          title="Soil Type"
          label="Select Type"
          options={SOIL_TYPES}
          value={field.value}
          enabled={enabled}
          error={error}
          onChange={field.onChange}
          testID="farmer-soil-type"
        />
      )}
    />
  );
}

function YearsExperienceField({
  control,
  error,
  enabled,
}: {
  control: Control<FarmerForm>;
  error?: string;
  enabled: boolean;
}) {
  return (
    <Controller
      control={control}
      name="yearsExperience"
      render={({ field }) => (
        <AppTextField
          title="Years Experience"
          hintText="0"
          keyboardType="number-pad"
          enabled={enabled}
          value={field.value}
          onChangeText={(t) => field.onChange(t.replace(/\D/g, ''))}
          onBlur={field.onBlur}
          error={error}
          testID="farmer-years-experience"
        />
      )}
    />
  );
}

function WaterSourceField({
  control,
  error,
  enabled,
}: {
  control: Control<FarmerForm>;
  error?: string;
  enabled: boolean;
}) {
  return (
    <Controller
      control={control}
      name="waterSource"
      render={({ field }) => (
        <AppDropdown
          title="Water Source"
          label="Select Source"
          options={WATER_SOURCES}
          value={field.value}
          enabled={enabled}
          error={error}
          onChange={field.onChange}
          testID="farmer-water-source"
        />
      )}
    />
  );
}

function IrrigationField({
  control,
  enabled,
}: {
  control: Control<FarmerForm>;
  enabled: boolean;
}) {
  return (
    <Controller
      control={control}
      name="irrigationAccess"
      render={({ field }) => (
        <View>
          <Text style={styles.fieldLabel}>Irrigation Access?</Text>
          <Switch
            accessibilityLabel="Irrigation Access?"
            disabled={!enabled}
            value={field.value}
            onValueChange={field.onChange}
            trackColor={{ true: colors.primary, false: colors.secondary200 }}
            thumbColor={colors.white}
            testID="farmer-irrigation"
          />
        </View>
      )}
    />
  );
}

// ------------------------------------------------------------- Uploads
export interface UploadsSectionProps {
  control: Control<FarmerForm>;
  errors: FieldErrors<FarmerForm>;
  farmerPhoto: ImageFieldState;
  idCard: ImageFieldState;
  landDocument: ImageFieldState;
  farmPhotos: ImageListFieldState;
  /** Current `landDocumentType` value, for the card subtitle. */
  landDocumentType: string;
  enabled?: boolean;
}

export function UploadsSection({
  control,
  errors,
  farmerPhoto,
  idCard,
  landDocument,
  farmPhotos,
  landDocumentType,
  enabled = true,
}: UploadsSectionProps) {
  return (
    <View>
      <SectionTitle title="Uploads" />
      <Gap />

      <UploadCard
        title="Farmer Photo"
        previewUri={farmerPhoto.previewUri}
        hasValue={farmerPhoto.hasValue}
        uploading={farmerPhoto.uploading}
        onPress={() => void farmerPhoto.chooseFromLibrary()}
        onClear={farmerPhoto.clear}
        testID="upload-farmer-photo"
      />

      <Gap size={12} />

      <UploadCard
        title="ID Card (NIN/DL/Passport)"
        previewUri={idCard.previewUri}
        hasValue={idCard.hasValue}
        uploading={idCard.uploading}
        onPress={() => void idCard.chooseFromLibrary()}
        onClear={idCard.clear}
        testID="upload-id-card"
      />

      <Gap size={12} />

      <UploadCard
        title="Land Document"
        subtitle={
          landDocumentType.trim().length > 0
            ? `Type: ${landDocumentType.trim()}`
            : 'Optional'
        }
        previewUri={landDocument.previewUri}
        hasValue={landDocument.hasValue}
        uploading={landDocument.uploading}
        onPress={() => void landDocument.chooseFromLibrary()}
        onClear={landDocument.clear}
        testID="upload-land-doc"
      />

      {/*
        Dart condition on Add was `landDocument != null`; on Edit it was
        widened to `landDocument != null || landDocumentUrl != null`. The
        widened form is correct for both, and `hasValue` covers each case.
      */}
      {landDocument.hasValue ? (
        <>
          <Gap size={8} />
          <Controller
            control={control}
            name="landDocumentType"
            render={({ field }) => (
              <AppTextField
                title="Document Type"
                hintText="e.g. C of O, Deed"
                enabled={enabled}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={errors.landDocumentType?.message}
                testID="upload-land-doc-type"
              />
            )}
          />
        </>
      ) : null}

      <Gap size={12} />

      <MultiUploadCard
        title="Farm Photos"
        urls={farmPhotos.urls}
        pendingUris={farmPhotos.pending.map((p) => p.uri)}
        uploading={farmPhotos.uploading}
        onPress={() => void farmPhotos.add()}
        onRemove={farmPhotos.removeAt}
        testID="upload-farm-photos"
      />
    </View>
  );
}

/** The form heading block — differs only in its three strings. */
export function FormHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <View>
      <Text accessibilityRole="header" style={styles.formTitle}>
        {title}
      </Text>
      <Gap size={8} />
      <Text style={styles.formSubtitle}>{subtitle}</Text>
    </View>
  );
}

/** A plain text link row, used by the details screen's section actions. */
export function TextLink({
  label,
  onPress,
  color = colors.primary,
}: {
  label: string;
  onPress: () => void;
  color?: string;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress}>
      <Text style={[styles.link, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  cell: {
    flex: 1,
  },
  fieldLabel: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
  },
  formTitle: {
    ...textTheme.headlineMedium,
    fontSize: spMin(20),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
  },
  formSubtitle: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    color: colors.grey,
  },
  link: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
  },
});
