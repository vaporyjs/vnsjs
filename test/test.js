var VNS = require('../index.js');
var web3Utils = require('@vapory/web3-utils');
var assert = require('assert');
var fs = require('fs');
var solc = require('@vapory/solc');
var TestRPC = require('@moxiesuite/ganache-cli');

var niv = require('npm-install-version');
niv.install('@vapory/web3@1.0.0-delta.30');
niv.install('@vapory/web3@0.20.4-b');

var Web3_0 = niv.require('@vapory/web3@0.20.4-b');
var Web3_1 = niv.require('@vapory/web3@1.0.0-delta.30');

var vns = null;
var vnsRoot = null;
var accounts = null;
var deployvns = null;
var deployvnsAddress = null;
var web3 = null;

var registryInterface = [{"constant":true,"inputs":[{"name":"node","type":"bytes32"}],"name":"resolver","outputs":[{"name":"","type":"address"}],"type":"function"},{"constant":true,"inputs":[{"name":"node","type":"bytes32"}],"name":"owner","outputs":[{"name":"","type":"address"}],"type":"function"},{"constant":false,"inputs":[{"name":"node","type":"bytes32"},{"name":"resolver","type":"address"}],"name":"setResolver","outputs":[],"type":"function"},{"constant":false,"inputs":[{"name":"node","type":"bytes32"},{"name":"label","type":"bytes32"},{"name":"owner","type":"address"}],"name":"setSubnodeOwner","outputs":[],"type":"function"},{"constant":false,"inputs":[{"name":"node","type":"bytes32"},{"name":"owner","type":"address"}],"name":"setOwner","outputs":[],"type":"function"}];


// suppressing MaxEventListeners error as we are adding many listeners
// to the same web3 provider's "data" event for multiple VNS instances
// https://github.com/ethereum/web3.js/blob/1.0/packages/web3-core-requestmanager/src/index.js#L98
require('events').EventEmitter.prototype._maxListeners = 100;

// Reuse tests
var testSuiteGenerator = function(beforeHook, afterHook) {
	return function() {
		if (typeof beforeHook === 'function') before(beforeHook);
		if (typeof afterHook === 'function') after(afterHook);
		describe('#resolve()', function() {
			it('should get resolver addresses', function(done) {
				vns.resolver('foo.vap').resolverAddress().then(function(addr) {
					assert.notEqual(addr, '0x0000000000000000000000000000000000000000');
					done();
				}).catch(assert.ifError);
			});

			it('should resolve names', function(done) {
				vns.resolver('foo.vap').addr()
				.then(function(result) {
					assert.equal(result, deployvnsAddress);
					done();
				}).catch(assert.ifError);
			});

			it('should implement has()', function(done) {
				var resolver = vns.resolver('foo.vap');
				Promise.all([
					resolver.has(web3Utils.asciiToHex('addr'))
					.then(function(result) {
						assert.equal(result, true);
					}),
					resolver.has(web3Utils.asciiToHex('blah'))
					.then(function(result) {
						assert.equal(result, false);
					})
				]).catch(assert.ifError).then(function(result) {done()});
			});

			it('should error when the name record does not exist', function(done) {
				vns.resolver('bar.vap').addr()
				.catch(function(err) {
					assert.ok(err.toString().indexOf('invalid JUMP') != -1, err);
					done();
				});
			});

			it('should error when the name does not exist', function(done) {
				vns.resolver('quux.vap').addr()
				.catch(function(err) {
					assert.equal(err, VNS.NameNotFound);
					done();
				});
			});

			it('should permit name updates', function(done) {
				var resolver = vns.resolver('bar.vap')
				resolver.setAddr('0x0000000000000000000000000000000000012345', {from: accounts[0]})
				.then(function(result) {
					return resolver.addr()
					.then(function(result) {
						assert.equal(result, '0x0000000000000000000000000000000000012345');
						done();
					});
				});
			});

			it('should do reverse resolution', function(done) {
				var resolver = vns.resolver('foo.vap');
				resolver.reverseAddr().then(function(reverse) {
					return reverse.name().then(function(result) {
						assert.equal(result, "deployer.vap");
						done();
					});
				}).catch(assert.isError);
			});

			it('should fetch ABIs from names', function(done) {
				vns.resolver('foo.vap').abi()
				.then(function(abi) {
					assert.equal(abi.length, 2);
					assert.equal(abi[0].name, "test2");
					done();
				}).catch(assert.isError);
			});

			it('should fetch ABIs from reverse records', function(done) {
				vns.resolver('baz.vap').abi().then(function(abi) {
					assert.equal(abi.length, 2);
					assert.equal(abi[0].name, "test");
					done();
				}).catch(assert.isError);
			});

			it('should fetch contract instances', function(done) {
				vns.resolver('baz.vap').contract().then(function(contract) {
					assert.ok(contract.test != undefined || contract.methods.test != undefined);
					done();
				}).catch(assert.isError);
			});
		});

		describe('#owner()', function() {
			it('should return owner values', function(done) {
				vns.owner('bar.vap').then(function(result) {
					assert.equal(result, accounts[0]);
					done();
				}).catch(assert.isError);
			});
		});

		describe("#setSubnodeOwner", function() {
			it('should permit setting subnode owners', function(done) {
				vns.setSubnodeOwner('BAZ.bar.vap', accounts[0], {from: accounts[0]}).then(function(txid) {
					return vns.owner('baz.bar.vap').then(function(owner) {
						assert.equal(owner, accounts[0]);
						done();
					});
				}).catch(assert.isError);
			});
		});

		describe("#setResolver", function() {
			it('should permit resolver updates', function(done) {
				var addr = '0x2341234123412341234123412341234123412341';
				vns.setResolver('baz.bar.vap', addr, {from: accounts[0]}).then(function(txid) {
					return vns.resolver('baz.bar.vap').resolverAddress().then(function(address) {
						assert.equal(address, addr);
						done();
					});
				}).catch(assert.isError);
			});
		});

		describe("#setOwner", function() {
			it('should permit owner updates', function(done) {
				var addr = '0x3412341234123412341234123412341234123412';
				vns.setOwner('baz.bar.vap', addr, {from: accounts[0]})
				.then(function(txid) {
					return vns.owner('baz.bar.vap').then(function(owner) {
						assert.equal(owner, addr);
						done();
					});
				}).catch(assert.isError);
			});
		});

		describe("#reverse", function() {
			it('should look up reverse DNS records', function(done) {
				vns.reverse(deployvnsAddress).name()
				.then(function(result) {
					assert.equal(result, 'deployer.vap');
					done();
				}).catch(assert.isError);
			});
		});
	}
}

describe('VNS (Web3 1.x)', testSuiteGenerator(
	function(done) {
		if (web3 === null) {
			web3 = new Web3_1();
		}
		this.timeout(20000);
		web3.setProvider(TestRPC.provider());
		//web3.setProvider(new web3.providers.HttpProvider('http://localhost:8545'));
		web3.vap.getAccounts(function(err, acct) {
			if (acct) accounts = acct;
			var source = fs.readFileSync('test/vns.sol').toString();
			var compiled = solc.compile(source, 1);
			assert.equal(compiled.errors, undefined);
			var deployer = compiled.contracts[':DeployVNS'];
			var deployvnsContract = new web3.vap.Contract(JSON.parse(deployer.interface));

			// Deploy the contract
			deployvnsContract.deploy({
				data: deployer.bytecode
			})
			.send({
				from: accounts[0],
				gas: 4700000
			})
			.on('error', function(err) { assert.ifError(err); })
			.then(function(newContractInstance) {
				deployvns = newContractInstance;
				if (deployvns.options.address != undefined) {
					deployvns.methods.vns().call().then(function(value) {
						vnsRoot = value;
						if (vns && vns.web3) {
							vns.web3.reset();
						}
						vns = new VNS(web3.currentProvider, vnsRoot, Web3_1);
						deployvnsAddress = deployvns.address || deployvns._address;
						done();
					}).catch(function(err) {
						assert.ifError(err);
					})
				} else {
					assert.ifError("Contract address is null", contract);
				}
			})
			.catch(function(err) { assert.ifError(err); });
		});
	},
	function() {
		vns = null;
		vnsRoot = null;
		accounts = null;
		deployvns = null;
		deployvnsAddress = null;
		web3 = null;
	}
));


describe('VNS (Web3 0.x)', testSuiteGenerator(function(done) {
	this.timeout(20000);
	if (web3 === null) {
		web3 = new Web3_0();
	}
	web3.setProvider(TestRPC.provider());
	//web3.setProvider(new web3.providers.HttpProvider('http://localhost:8545'));
	web3.vap.getAccounts(function(err, acct) {
		accounts = acct
		var source = fs.readFileSync('test/vns.sol').toString();
		var compiled = solc.compile(source, 1);
		assert.equal(compiled.errors, undefined);
		var deployer = compiled.contracts[':DeployVNS'];
		var deployvnsContract = web3.vap.contract(JSON.parse(deployer.interface));

		// Deploy the contract
		deployvns = deployvnsContract.new(
		   {
		     from: accounts[0],
		     data: deployer.bytecode,
		     gas: 4700000
		   }, function(err, contract) {
		   	    assert.equal(err, null, err);
		   	    if(contract.address != undefined) {
		   	    	// Fetch the address of the VNS registry
		   	 		contract.vns.call(function(err, value) {
		   	 			assert.equal(err, null, err);
		   	 			vnsRoot = value;
							vns = new VNS(web3.currentProvider, vnsRoot, Web3_0);
							deployvnsAddress = deployvns.address || deployvns._address;
		   	 			done();
		   	 		});
			   	 }
		   });
	});
}));
