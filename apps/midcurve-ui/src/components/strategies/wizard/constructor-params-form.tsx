"use client";

import { useEffect, useMemo, useCallback } from "react";
import type {
  ConstructorParam,
  ConstructorParamUI,
  StrategyManifest,
} from "@midcurve/shared";
import { getUserInputParams, getDefaultUIElement } from "@midcurve/shared";
import {
  TextInput,
  BigIntInput,
  NumberInput,
  AddressInput,
  BooleanInput,
  SectionHeading,
  Separator,
} from "./form-fields";

interface ConstructorParamsFormProps {
  manifest: StrategyManifest;
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  onValidationChange: (isValid: boolean) => void;
  errors?: Record<string, string>;
}

/**
 * Dynamic form component that renders fields based on manifest's constructorParams
 *
 * Only renders params with source === 'user-input'
 * Supports both simple param list and rich formLayout with sections/separators
 */
export function ConstructorParamsForm({
  manifest,
  values,
  onChange,
  onValidationChange,
  errors = {},
}: ConstructorParamsFormProps) {
  // Get only user-input params
  const userInputParams = useMemo(
    () => getUserInputParams(manifest),
    [manifest]
  );

  // Initialize default values for params with defaults
  useEffect(() => {
    const defaults: Record<string, string> = {};
    let hasNewDefaults = false;

    for (const param of userInputParams) {
      if (values[param.name] === undefined && param.ui?.default !== undefined) {
        defaults[param.name] = param.ui.default;
        hasNewDefaults = true;
      }
    }

    if (hasNewDefaults) {
      onChange({ ...values, ...defaults });
    }
  }, [userInputParams, values, onChange]);

  // Validate all fields
  const validateParams = useCallback(() => {
    for (const param of userInputParams) {
      const value = values[param.name] ?? "";
      const ui = param.ui;
      const isRequired = ui?.required !== false;

      // Required check
      if (isRequired && !value) {
        return false;
      }

      // Type-specific validation
      if (value) {
        switch (ui?.element ?? getDefaultUIElement(param.type)) {
          case "evm-address":
            if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
              return false;
            }
            break;
          case "bigint":
          case "number":
            // Min/max validation
            if (ui?.min !== undefined) {
              try {
                if (BigInt(value) < BigInt(ui.min)) return false;
              } catch {
                return false;
              }
            }
            if (ui?.max !== undefined) {
              try {
                if (BigInt(value) > BigInt(ui.max)) return false;
              } catch {
                return false;
              }
            }
            break;
        }
      }
    }

    return true;
  }, [userInputParams, values]);

  // Report validation state to parent
  useEffect(() => {
    const isValid = validateParams();
    onValidationChange(isValid);
  }, [validateParams, onValidationChange]);

  // Handle field value change
  const handleFieldChange = (name: string) => (value: string) => {
    onChange({ ...values, [name]: value });
  };

  // Get UI config for a param (with fallback defaults)
  const getUIConfig = (param: ConstructorParam): ConstructorParamUI => {
    const defaultElement = getDefaultUIElement(param.type);
    return {
      element: param.ui?.element ?? defaultElement,
      label: param.ui?.label ?? param.name,
      description: param.ui?.description,
      placeholder: param.ui?.placeholder,
      default: param.ui?.default,
      required: param.ui?.required ?? true,
      min: param.ui?.min,
      max: param.ui?.max,
      step: param.ui?.step,
      decimals: param.ui?.decimals,
      pattern: param.ui?.pattern,
    };
  };

  // Render a single param field
  const renderParamField = (param: ConstructorParam) => {
    const ui = getUIConfig(param);
    const value = values[param.name] ?? "";
    const error = errors[param.name];
    const onFieldChange = handleFieldChange(param.name);

    // Skip hidden fields
    if (ui.element === "hidden") {
      return null;
    }

    const commonProps = {
      name: param.name,
      ui,
      value,
      onChange: onFieldChange,
      error,
    };

    switch (ui.element) {
      case "text":
        return <TextInput key={param.name} {...commonProps} />;
      case "bigint":
        return <BigIntInput key={param.name} {...commonProps} />;
      case "number":
        return <NumberInput key={param.name} {...commonProps} />;
      case "evm-address":
        return <AddressInput key={param.name} {...commonProps} />;
      case "boolean":
        return <BooleanInput key={param.name} {...commonProps} />;
      default:
        // Fallback to text input
        return <TextInput key={param.name} {...commonProps} />;
    }
  };

  // Render form using formLayout if provided, otherwise simple list
  const renderForm = () => {
    // If formLayout is provided, use it for rich rendering
    if (manifest.formLayout && manifest.formLayout.length > 0) {
      return manifest.formLayout.map((item, index) => {
        if (item.type === "layout") {
          if (item.layout.element === "section") {
            return <SectionHeading key={`layout-${index}`} layout={item.layout} />;
          }
          if (item.layout.element === "separator") {
            return <Separator key={`layout-${index}`} />;
          }
          return null;
        }

        // It's a param
        if (item.param.source !== "user-input") {
          return null;
        }
        return renderParamField(item.param);
      });
    }

    // Simple rendering: just list user-input params in order
    return userInputParams.map((param) => renderParamField(param));
  };

  // If no user-input params, show a message
  if (userInputParams.length === 0) {
    return (
      <div className="bg-slate-800/30 border border-slate-700/30 rounded-lg p-4 text-center">
        <p className="text-slate-400 text-sm">
          This strategy has no configurable parameters.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {renderForm()}
    </div>
  );
}
