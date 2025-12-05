// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../src/libraries/LoggingLib.sol";

/// @dev Contract that uses LoggingLib for testing
contract LoggingLibUser {
    using LoggingLib for *;

    function emitDebug(string memory message) external {
        LoggingLib.logDebug(message);
    }

    function emitDebugWithData(string memory message, bytes memory data) external {
        LoggingLib.logDebug(message, data);
    }

    function emitInfo(string memory message) external {
        LoggingLib.logInfo(message);
    }

    function emitInfoWithData(string memory message, bytes memory data) external {
        LoggingLib.logInfo(message, data);
    }

    function emitWarn(string memory message) external {
        LoggingLib.logWarn(message);
    }

    function emitWarnWithData(string memory message, bytes memory data) external {
        LoggingLib.logWarn(message, data);
    }

    function emitError(string memory message) external {
        LoggingLib.logError(message);
    }

    function emitErrorWithData(string memory message, bytes memory data) external {
        LoggingLib.logError(message, data);
    }
}

contract LoggingLibTest is Test {
    LoggingLibUser public logger;

    event LogMessage(LoggingLib.LogLevel indexed level, string message, bytes data);

    function setUp() public {
        logger = new LoggingLibUser();
    }

    function test_logDebug_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit LogMessage(LoggingLib.LogLevel.Debug, "debug message", "");
        logger.emitDebug("debug message");
    }

    function test_logDebug_withData_emitsEvent() public {
        bytes memory data = abi.encode(uint256(42));
        vm.expectEmit(true, false, false, true);
        emit LogMessage(LoggingLib.LogLevel.Debug, "debug message", data);
        logger.emitDebugWithData("debug message", data);
    }

    function test_logInfo_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit LogMessage(LoggingLib.LogLevel.Info, "info message", "");
        logger.emitInfo("info message");
    }

    function test_logInfo_withData_emitsEvent() public {
        bytes memory data = abi.encode(address(0xBEEF));
        vm.expectEmit(true, false, false, true);
        emit LogMessage(LoggingLib.LogLevel.Info, "info message", data);
        logger.emitInfoWithData("info message", data);
    }

    function test_logWarn_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit LogMessage(LoggingLib.LogLevel.Warn, "warn message", "");
        logger.emitWarn("warn message");
    }

    function test_logWarn_withData_emitsEvent() public {
        bytes memory data = abi.encode(int24(-100));
        vm.expectEmit(true, false, false, true);
        emit LogMessage(LoggingLib.LogLevel.Warn, "warn message", data);
        logger.emitWarnWithData("warn message", data);
    }

    function test_logError_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit LogMessage(LoggingLib.LogLevel.Error, "error message", "");
        logger.emitError("error message");
    }

    function test_logError_withData_emitsEvent() public {
        bytes memory data = abi.encode(uint256(0xDEADBEEF));
        vm.expectEmit(true, false, false, true);
        emit LogMessage(LoggingLib.LogLevel.Error, "error message", data);
        logger.emitErrorWithData("error message", data);
    }

    function test_logLevels_areDistinct() public pure {
        assertTrue(uint8(LoggingLib.LogLevel.Debug) == 0);
        assertTrue(uint8(LoggingLib.LogLevel.Info) == 1);
        assertTrue(uint8(LoggingLib.LogLevel.Warn) == 2);
        assertTrue(uint8(LoggingLib.LogLevel.Error) == 3);
    }
}
