/**
 * Add / edit one farm (v2 "Add Another Farm").
 *
 * No Flutter equivalent — the Dart app had one farm per farmer, edited inside
 * the farmer form.
 *
 * The farm fields come from `FarmProfileSection`, the same component
 * onboarding and Edit Farmer use, so the questions, the dropdown options and
 * the validation messages cannot drift between "the first farm" and "the
 * second farm". That is also why the form type is `FarmerForm` with the
 * personal half left blank: see `farmFormSchema`.
 *
 * Editing sends a PARTIAL update — only the fields on this form. The server's
 * farm patch writes just the keys it receives, so the walked boundary,
 * `gps_mapped` and the computed area survive an edit of the soil type, which
 * is what the v2 flow requires of every edit screen ("omitted fields must not
 * be cleared").
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';

import { AppButton } from '../../../components/AppButton';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { AuthBackButton } from '../../../components/BaseAppBar';
import { h, r } from '../../../core/theme/responsive';
import { FarmProfileSection } from '../components/FarmerFormSections';
import { useAddFarm, useFarmerFarms, useUpdateFarm } from '../hooks/useFarmerFarms';
import type { FarmerFarmProfile, FarmProfileBody } from '../model/farmer';
import { emptyFarmForm, farmFormSchema, type FarmerForm } from '../model/validation';

import { useRouteParams } from './routeParams';

export interface FarmFormScreenProps {
  farmerId?: string;
  /** Absent for "Add Another Farm", present when editing one. */
  farmId?: string;
}

export function FarmFormScreen({
  farmerId: farmerIdProp,
  farmId: farmIdProp,
}: FarmFormScreenProps = {}) {
  const router = useRouter();
  const params = useRouteParams();
  const farmerId = farmerIdProp ?? params.id ?? '';
  const farmId = farmIdProp ?? params.farmId;
  const isEdit = Boolean(farmId);

  // The farm being edited comes from the already-cached set rather than a
  // second endpoint: the agent arrives here from the farms list, so the data
  // is in hand and a fetch would only add a spinner.
  const { farms, isLoading } = useFarmerFarms(farmerId, isEdit);
  const farm = isEdit ? farms.find((f) => f.id === farmId) : undefined;

  const { addFarm, isPending: adding } = useAddFarm(farmerId);
  const { updateFarm, isPending: updating } = useUpdateFarm(farmerId);

  const {
    control,
    handleSubmit,
    setValue,
    reset,
    watch,
    formState: { errors },
  } = useForm<FarmerForm>({
    resolver: zodResolver(farmFormSchema),
    mode: 'onTouched',
    defaultValues: emptyFarmForm,
  });

  // Prefill once the farm has loaded. `reset` rather than per-field setValue so
  // the form is not marked dirty by its own prefill — an agent who opens the
  // screen and backs out should not be warned about unsaved changes.
  useEffect(() => {
    if (farm) reset(toFarmForm(farm));
  }, [farm, reset]);

  const values = watch();

  const onSubmit = (form: FarmerForm) => {
    const body = toFarmBody(form);

    if (isEdit && farmId) {
      updateFarm({ farmId, farm: body }, { onSuccess: () => router.back() });
      return;
    }
    addFarm(body, { onSuccess: () => router.back() });
  };

  return (
    <AppSkeleton
      appBarTitle={isEdit ? 'Edit Farm' : 'Add Another Farm'}
      appBarLeading={<AuthBackButton />}
      isBusy={isEdit && isLoading && !farm}
      scrollable
      bottomBar={
        <View style={styles.bottomBar}>
          <AppButton
            text={isEdit ? 'Save Changes' : 'Add Farm'}
            loading={adding || updating}
            onPress={handleSubmit(onSubmit)}
            testID="farm-submit"
          />
        </View>
      }
    >
      <View style={{ height: h(16) }} />

      <FarmProfileSection
        control={control}
        errors={errors}
        setValue={setValue}
        values={values}
      />

      <View style={{ height: h(30) }} />
    </AppSkeleton>
  );
}

/** Farm row -> form values. Numbers become strings; nulls become blanks. */
function toFarmForm(farm: FarmerFarmProfile): FarmerForm {
  return {
    ...emptyFarmForm,
    farmLabel: farm.farmLabel ?? '',
    farmSizeAcres: farm.farmSizeAcres?.toString() ?? '',
    cropType: farm.cropType ?? '',
    secondaryCrops: [...farm.secondaryCrops],
    soilType: farm.soilType ?? '',
    yearsExperience: farm.yearsExperience?.toString() ?? '',
    waterSource: farm.waterSource ?? '',
    irrigationAccess: farm.irrigationAccess ?? false,
    landOwnership: farm.landOwnership ?? '',
    gpsLat: farm.gpsLat != null ? String(farm.gpsLat) : '',
    gpsLng: farm.gpsLng != null ? String(farm.gpsLng) : '',
  };
}

/**
 * Form values -> request body.
 *
 * Blank strings become `undefined` so they are omitted rather than sent as
 * empty or zero: an omitted key leaves the stored value alone, while `0` would
 * overwrite a real farm size with nothing and a `''` would fail the
 * validator's enum-ish checks. `secondaryCrops` is the deliberate exception —
 * an empty array is how the agent clears the list.
 *
 * `gpsPolygon` is never sent from here. The boundary is captured on the map
 * screen, and sending `undefined` leaves it untouched; sending the two
 * coordinates does not disturb it either, because the server only recomputes
 * the area when a polygon is present.
 */
function toFarmBody(form: FarmerForm): FarmProfileBody {
  const text = (value: string) => {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };
  const number = (value: string) => {
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const integer = (value: string) => {
    const parsed = number(value);
    return parsed != null ? Math.trunc(parsed) : undefined;
  };

  return {
    farmLabel: text(form.farmLabel),
    farmSizeAcres: number(form.farmSizeAcres),
    cropType: text(form.cropType),
    secondaryCrops: form.secondaryCrops,
    soilType: text(form.soilType),
    irrigationAccess: form.irrigationAccess,
    waterSource: text(form.waterSource),
    landOwnership: text(form.landOwnership),
    yearsExperience: integer(form.yearsExperience),
    gpsLat: number(form.gpsLat),
    gpsLng: number(form.gpsLng),
  };
}

const styles = StyleSheet.create({
  bottomBar: {
    paddingHorizontal: r(20),
    paddingBottom: h(12),
  },
});
