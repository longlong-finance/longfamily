const { BN } = require("@openzeppelin/test-helpers/src/setup");
const { assert } = require("hardhat");

function approxInAbsDiff(expected, actual, tolerance, verbose = false){
  expected = new BN(expected);
  actual = new BN(actual);
  tolerance = new BN(tolerance);
  if(verbose){
    console.log("expected:  ", expected.toString());
    console.log("actual:    ", actual.toString());
    console.log("tolerance: ", tolerance.toString());
  }

  assert.equal(
    true,
    ((expected).sub(actual)).abs().lte(tolerance)
  );
}

function approxBN(expected, actual, decimal, verbose = false) {

  expected = new BN(expected);
  actual = new BN(actual);

  let tolerance = (expected.div( new BN(10 ** decimal) ));

  approxInAbsDiff(expected, actual, tolerance, verbose);
}

function equalBN(expected, actual, verbose = false) {
  if(verbose){
    console.log("expected:  ", expected.toString());
    console.log("actual:    ", actual.toString());
  }

  assert.equal(expected.toString(), actual.toString());
}

function ltBN(expected, actual, verbose = false) {
  expected = new BN(expected);
  actual = new BN(actual);

  if(verbose){
    console.log("expected:  ", expected.toString());
    console.log("actual:    ", actual.toString());
  }

  assert.equal(expected.lt(actual), true);
}

function gtBN(expected, actual, verbose = false) {
  expected = new BN(expected);
  actual = new BN(actual);

  if(verbose){
    console.log("expected:  ", expected.toString());
    console.log("actual:    ", actual.toString());
  }

  assert.equal(expected.gt(actual), true);
}

module.exports = {
  approxBN,
  approxInAbsDiff,
  equalBN,
  ltBN,
  gtBN
};