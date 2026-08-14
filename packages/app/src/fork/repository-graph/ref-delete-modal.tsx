import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { CheckSquare2, Square } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import type { Theme } from "@/styles/theme";

interface RefDeleteModalProps {
  visible: boolean;
  name: string;
  kind: "head" | "remote" | "tag";
  hasUpstream: boolean;
  onClose: () => void;
  onSubmit: (options: { force: boolean; deleteOnRemote: boolean }) => Promise<void>;
}

const ThemedSquare = withUnistyles(Square);
const ThemedCheckSquare = withUnistyles(CheckSquare2);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const accentColorMapping = (theme: Theme) => ({ color: theme.colors.accent });

function DeleteOption({
  checked,
  disabled = false,
  label,
  onPress,
  testID,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onPress: () => void;
  testID: string;
}) {
  const Icon = checked ? ThemedCheckSquare : ThemedSquare;
  const accessibilityState = useMemo(() => ({ checked, disabled }), [checked, disabled]);
  return (
    <Pressable
      style={styles.option}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={accessibilityState}
      testID={testID}
    >
      <Icon size={18} uniProps={checked ? accentColorMapping : mutedColorMapping} />
      <Text style={[styles.optionText, disabled && styles.optionTextDisabled]}>{label}</Text>
    </Pressable>
  );
}

export function RefDeleteModal({
  visible,
  name,
  kind,
  hasUpstream,
  onClose,
  onSubmit,
}: RefDeleteModalProps) {
  const { t } = useTranslation();
  const [force, setForce] = useState(false);
  const [deleteOnRemote, setDeleteOnRemote] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setForce(false);
    setDeleteOnRemote(false);
    setIsPending(false);
    setError(null);
  }, [visible]);

  const title =
    kind === "tag"
      ? t("workspace.repositoryGraph.actions.deleteTag")
      : t("workspace.repositoryGraph.actions.deleteBranch");
  const header = useMemo<SheetHeader>(() => ({ title }), [title]);
  const toggleForce = useCallback(() => setForce((value) => !value), []);
  const toggleRemote = useCallback(() => setDeleteOnRemote((value) => !value), []);
  const handleClose = useCallback(() => {
    if (!isPending) onClose();
  }, [isPending, onClose]);
  const handleSubmit = useCallback(async () => {
    if (isPending) return;
    setIsPending(true);
    setError(null);
    try {
      await onSubmit({ force, deleteOnRemote });
      setIsPending(false);
      onClose();
    } catch (submitError) {
      setIsPending(false);
      setError(
        submitError instanceof Error
          ? submitError.message
          : t("workspace.repositoryGraph.actions.deleteFailed"),
      );
    }
  }, [deleteOnRemote, force, isPending, onClose, onSubmit, t]);
  const handleSubmitVoid = useCallback(() => void handleSubmit(), [handleSubmit]);

  return (
    <AdaptiveModalSheet visible={visible} onClose={handleClose} header={header} testID="ref-delete">
      <View style={styles.body}>
        <Text style={styles.message}>
          {t("workspace.repositoryGraph.actions.deleteMessage", { name })}
        </Text>
        {kind === "head" ? (
          <DeleteOption
            checked={force}
            disabled={isPending}
            label={t("workspace.repositoryGraph.actions.forceDelete")}
            onPress={toggleForce}
            testID="ref-delete-force"
          />
        ) : null}
        {kind === "head" && hasUpstream ? (
          <DeleteOption
            checked={deleteOnRemote}
            disabled={isPending}
            label={t("workspace.repositoryGraph.actions.deleteOnRemote")}
            onPress={toggleRemote}
            testID="ref-delete-remote"
          />
        ) : null}
        {error ? (
          <Text style={styles.error} testID="ref-delete-error">
            {error}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <Button variant="secondary" size="sm" style={styles.button} onPress={handleClose}>
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            style={styles.button}
            loading={isPending}
            disabled={isPending}
            onPress={handleSubmitVoid}
            testID="ref-delete-submit"
          >
            {t("workspace.repositoryGraph.actions.delete")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: { gap: theme.spacing[3], paddingBottom: theme.spacing[2] },
  message: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  option: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  optionText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  optionTextDisabled: { color: theme.colors.foregroundMuted },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
  actions: { flexDirection: "row", gap: theme.spacing[2] },
  button: { flex: 1 },
}));
