// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title LoggingLib
 * @notice Library for strategy logging
 * @dev Emits events that Core captures and stores for debugging
 */
library LoggingLib {
    /// @notice Log levels for categorizing messages
    enum LogLevel {
        Debug,
        Info,
        Warn,
        Error
    }

    /// @notice Emitted when a strategy logs a message
    /// @param level The log level (Debug, Info, Warn, Error)
    /// @param message The log message
    /// @param data Additional data (can be empty)
    event LogMessage(LogLevel indexed level, string message, bytes data);

    /// @notice Log a debug message
    /// @param message The message to log
    function logDebug(string memory message) internal {
        emit LogMessage(LogLevel.Debug, message, "");
    }

    /// @notice Log a debug message with additional data
    /// @param message The message to log
    /// @param data Additional data to include
    function logDebug(string memory message, bytes memory data) internal {
        emit LogMessage(LogLevel.Debug, message, data);
    }

    /// @notice Log an info message
    /// @param message The message to log
    function logInfo(string memory message) internal {
        emit LogMessage(LogLevel.Info, message, "");
    }

    /// @notice Log an info message with additional data
    /// @param message The message to log
    /// @param data Additional data to include
    function logInfo(string memory message, bytes memory data) internal {
        emit LogMessage(LogLevel.Info, message, data);
    }

    /// @notice Log a warning message
    /// @param message The message to log
    function logWarn(string memory message) internal {
        emit LogMessage(LogLevel.Warn, message, "");
    }

    /// @notice Log a warning message with additional data
    /// @param message The message to log
    /// @param data Additional data to include
    function logWarn(string memory message, bytes memory data) internal {
        emit LogMessage(LogLevel.Warn, message, data);
    }

    /// @notice Log an error message
    /// @param message The message to log
    function logError(string memory message) internal {
        emit LogMessage(LogLevel.Error, message, "");
    }

    /// @notice Log an error message with additional data
    /// @param message The message to log
    /// @param data Additional data to include
    function logError(string memory message, bytes memory data) internal {
        emit LogMessage(LogLevel.Error, message, data);
    }
}
