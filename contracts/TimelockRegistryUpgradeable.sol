// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
import "hardhat/console.sol";

import "./inheritance/StorageV1ConsumerUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/EnumerableSetUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";

/**
    TimelockRegistryUpgradeable is the place where we store all the timelock information between
    contracts except for proxy switching implementation. 

    Once the vault hooks up to this contract and have the timelock setting enabled here, 
    adding iv to the vault would be timelocked. There is also an option to add an IV to the 
    whole system, this way it is only timelocked once in the system and improves efficiency 
    while maintaining the initial runaway time. 
*/
contract TimelockRegistryUpgradeable is StorageV1ConsumerUpgradeable {
    using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;
    using SafeMathUpgradeable for uint256;
    
    EnumerableSetUpgradeable.AddressSet ivForGlobal;
    mapping(address => uint256) public ivForGlobalActiveTime;

    mapping (address => EnumerableSetUpgradeable.AddressSet) ivForVault;
    mapping (address => mapping (address => uint256)) public ivForVaultActiveTime;

    mapping (address => EnumerableSetUpgradeable.AddressSet) ivToBeInsuredByInsuranceVault;
    mapping (address => mapping(address => uint256)) public ivToBeInsuredByInsuranceVaultActiveTime;
    mapping (address => bool) public vaultTimelockEnabled;
     
    // Changing the timelock would always require a 24hrs delay
    uint256 public constant timelockChangeDelay = 24 hours;

    uint256 public timelockDelay;
    uint256 public newTimelockDelay;
    uint256 public newTimelockActiveTime;

    event TimelockDelayChanged(uint256 _newTimelockDelay);
    event VaultTimelockEnabled(address indexed _vault);
    event VaultIVAnnounced(address indexed _vault, address indexed _iv, uint256 activeTime);
    event GlobalIVAnnounced(address indexed _iv, uint256 activeTime);
    event InsuranceIVAnnounced(address indexed _insuranceVault, address indexed _iv, uint256 activeTime);
    event VaultIVRemoved(address indexed _vault, address indexed _iv);
    event GlobalIVRemoved(address indexed _iv);
    event InsurnaceIVRemoved(address indexed _insuranceVault, address indexed _iv);

    function initialize(address _store) public override virtual initializer {
        super.initialize(_store);
        timelockDelay = 0;          // initially there will be no delay to speed up configuration
        newTimelockDelay = 0;
        newTimelockActiveTime = 0;  // the initial effective timelock will be pointing to newTimelockDelay
    }

    function effectiveTimelock() public view returns (uint256) {
        return (block.timestamp > newTimelockActiveTime)? newTimelockDelay: timelockDelay;
    }

    function changeTimelockDelay(uint256 _newTimelockDelay) public onlyGovernance {
        timelockDelay = newTimelockDelay;
        newTimelockDelay = _newTimelockDelay;
        newTimelockActiveTime = (block.timestamp).add(timelockChangeDelay);
        emit TimelockDelayChanged(_newTimelockDelay);
    }

    function enableVaultTimelock(address _vault) public adminPriviledged {
        vaultTimelockEnabled[_vault] = true;
        emit VaultTimelockEnabled(_vault);
    }

    function announceIVForVault(address vault, address iv) public adminPriviledged {
        require(!ivForVault[vault].contains(iv), "IV already announced for vault");
        ivForVault[vault].add(iv);
        uint256 activeTime = (block.timestamp).add(effectiveTimelock());
        ivForVaultActiveTime[vault][iv] = activeTime;
        emit VaultIVAnnounced(vault, iv, activeTime);
    }

    function announceIVForGlobal(address iv) public adminPriviledged {
        require(!ivForGlobal.contains(iv), "IV already announced for global");
        ivForGlobal.add(iv);
        uint256 activeTime = (block.timestamp).add(effectiveTimelock());
        ivForGlobalActiveTime[iv] = activeTime;
        emit GlobalIVAnnounced(iv, activeTime);
    }

    function announceIVToBeInsuredByInsuranceVault(address vault, address iv) public adminPriviledged {
        require(!ivToBeInsuredByInsuranceVault[vault].contains(iv), "IV already announced for insurance vault");
        ivToBeInsuredByInsuranceVault[vault].add(iv);
        uint256 activeTime = (block.timestamp).add(effectiveTimelock());
        ivToBeInsuredByInsuranceVaultActiveTime[vault][iv] = activeTime;
        emit InsuranceIVAnnounced(vault, iv, activeTime);
    }

    function isIVActiveGlobal(address iv) public view returns (bool) {
        if(!ivForGlobal.contains(iv)) {
            return false;
        } else {
            return block.timestamp >= ivForGlobalActiveTime[iv];
        }
    }

    function isIVActiveForVault(address vault, address iv) public view returns (bool) {
        if(isIVActiveGlobal(iv)) {
            return true;
        } else if(!ivForVault[vault].contains(iv)) {
            return false;
        } else {
            return block.timestamp >= ivForVaultActiveTime[vault][iv];
        }
    }

    function isIVInsuredByInsuranceVault(address vault, address iv) public view returns (bool) {
        if(!ivToBeInsuredByInsuranceVault[vault].contains(iv)) {
            return false;
        } else {
            return block.timestamp >= ivToBeInsuredByInsuranceVaultActiveTime[vault][iv];
        }
    }

    function removeIVForVault(address vault, address iv) public adminPriviledged {
        ivForVault[vault].remove(iv);
        emit VaultIVRemoved(vault, iv);
    }

    function removeIVForGlobal(address iv) public adminPriviledged {
        ivForGlobal.remove(iv);
        emit GlobalIVRemoved(iv);
    }

    function stopFutureInsuringIV(address vault, address iv) public adminPriviledged {
        ivToBeInsuredByInsuranceVault[vault].remove(iv);
        emit InsurnaceIVRemoved(vault, iv);
    }
}