// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

interface IYearnController {
  function earn(address _token, uint _amount) external;
  function strategies(address _token) external view returns(address);

}
