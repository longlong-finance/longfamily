// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

interface IYearnStrategy {
  function harvest() external;
  function setStrategist(address _newStrategist) external;
}
