"use client";

interface LeverageSelectorProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
}

const QUICK_SELECT_VALUES = [1, 2, 5, 10, 25, 50];

export function LeverageSelector({
  value,
  onChange,
  min = 1,
  max = 50,
  disabled = false,
}: LeverageSelectorProps) {
  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(Number(e.target.value));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = Number(e.target.value);
    if (!isNaN(newValue) && newValue >= min && newValue <= max) {
      onChange(newValue);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-slate-300">Leverage</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={value}
            onChange={handleInputChange}
            min={min}
            max={max}
            disabled={disabled}
            className="w-16 px-2 py-1 text-sm text-right bg-slate-700/50 border border-slate-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
          <span className="text-sm text-slate-400">x</span>
        </div>
      </div>

      {/* Slider */}
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={handleSliderChange}
        disabled={disabled}
        className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-50
          [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:w-4
          [&::-webkit-slider-thumb]:h-4
          [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:bg-blue-500
          [&::-webkit-slider-thumb]:cursor-pointer
          [&::-webkit-slider-thumb]:hover:bg-blue-400
          [&::-moz-range-thumb]:w-4
          [&::-moz-range-thumb]:h-4
          [&::-moz-range-thumb]:rounded-full
          [&::-moz-range-thumb]:bg-blue-500
          [&::-moz-range-thumb]:border-0
          [&::-moz-range-thumb]:cursor-pointer"
      />

      {/* Quick Select Buttons */}
      <div className="flex gap-2">
        {QUICK_SELECT_VALUES.filter(v => v >= min && v <= max).map((quickValue) => (
          <button
            key={quickValue}
            onClick={() => onChange(quickValue)}
            disabled={disabled}
            className={`
              flex-1 px-2 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer
              ${value === quickValue
                ? "bg-blue-600 text-white"
                : "bg-slate-700/50 text-slate-400 hover:bg-slate-600/50 hover:text-slate-300"
              }
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
          >
            {quickValue}x
          </button>
        ))}
      </div>

      {/* Risk Warning */}
      {value >= 10 && (
        <p className="text-xs text-amber-400">
          High leverage increases liquidation risk
        </p>
      )}
    </div>
  );
}
