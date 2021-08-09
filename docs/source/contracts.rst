Contracts
=========

VaultUpgradeable
----------------
.. autosolcontract:: VaultUpgradeable
    :noindex:
    :members:

StakingMultiRewardsUpgradeable
------------------------------
.. autosolcontract:: StakingMultiRewardsUpgradeable
    :noindex:
    :members:

InvestmentVehicleSingleAssetBaseV1Upgradeable
---------------------------------------------
InvestmentVehicleSingleAssetBaseV1Upgradeable is the base contract for 
single asset IVs. It will receive only one kind of asset and invest into 
an investment opportunity. Every once in a while, operators should call the
`collectProfitAndDistribute` to perform accounting for relevant parties. 

Apart from the usual governance and operators, there are two roles for an IV: 

- "creditors" who lend their asset 
- "beneficiaries" who provide other services. (e.g. insurance, operations, tranches, boosts)

Interest are accrued to their contribution respectively. Creditors gets their interest with respect
to their lending amount, whereas the governance will set the ratio that is distributed to beneficiaries.

.. autosolcontract:: InvestmentVehicleSingleAssetBaseV1Upgradeable
    :noindex:
    :members:


SwapCenter
----------
.. autosolcontract:: SwapCenter
    :noindex:
    :members:

YearnV2VaultV1Base
------------------
.. autosolcontract:: YearnV2VaultV1Base
    :noindex:
    :members:


TimelockProxy
-------------
.. autosolcontract:: TimelockProxy
    :noindex:
    :members:

TimelockProxyStorageCentered
----------------------------
.. autosolcontract:: TimelockProxyStorageCentered
    :noindex:
    :members:

TimelockRegistryUpgradeable
---------------------------
.. autosolcontract:: TimelockRegistryUpgradeable
    :noindex:
    :members:

SelfCompoundingYieldUpgradeable
-------------------------------
.. autosolcontract:: SelfCompoundingYieldUpgradeable
    :noindex:
    :members: