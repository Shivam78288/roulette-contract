require('dotenv').config();
const Roulette = require('./build/contracts/Roulette.json');
const Token = require('./build/contracts/Token.json');
const Web3 = require("web3");
const web3 = new Web3(
    new Web3.providers.HttpProvider(
        "https://rpc-mumbai.matic.today"
    )
);

const { address: admin } = web3.eth.accounts.wallet.add(
    process.env.ADMIN_PK
);
// console.log(admin);

const { address: operator } = web3.eth.accounts.wallet.add(
    process.env.OPERATOR_PK
);
// console.log(admin)

const {address: player} = web3.eth.accounts.wallet.add(
    process.env.PLAYER_PK
);

// console.log(player)

const betPlayer =  [
    ["5", "0", ['5','8'], "10000000000000000000"],
    ["2", "0", ['1','2','3','4','5','6'], "10000000000000000000"],
    ["6", "0", ['25'], "10000000000000000000"],
    ["1", "0", ['25','26','27','28','29','30','31','32','33','34','35','36'], "10000000000000000000"],
];

const betOperator = [
    ["0", "1", ['1','3','5','7','9','11','13','15','17','19','21','23','25','27','29','31','33','35'], "10000000000000000000"],
    ["6", "0", ['5'], "10000000000000000000"],
    ["3", "0", ['4','5','7','8'], "10000000000000000000"],
    ["4", "0", ['31','32','33'], "10000000000000000000"]
];

const token = new web3.eth.Contract(
    Token.abi,
    "0xce746F6E5E99d9EE3457d1dcE5F69F4E27c12BD4"
);

// console.log(token.options.address);

const roulette = new web3.eth.Contract(
    Roulette.abi,
    "0x320b2B00B0ed8E2a5ce46E2884daff595dBbCA8C"
);

  
console.log('Started');

async function main() {
    
    const tokenBalOperator = await token.methods.balanceOf(operator).call();
    console.log(`Operator token bal: ${web3.utils.fromWei(tokenBalOperator)}`);

    const tokenBalPlayer = await token.methods.balanceOf(player).call();
    console.log(`Player token bal: ${web3.utils.fromWei(tokenBalPlayer)}`);

    await token.methods.approve(roulette.options.address, tokenBalOperator).send({
        from: operator,
        gasPrice: '10000000000',
        gas: 1000000
    });

    console.log(`Operator approved`);

    await token.methods.approve(roulette.options.address, tokenBalPlayer).send({
        from: player,
        gasPrice: '10000000000',
        gas: 1000000
    });

    console.log(`player approved`);

    await roulette.methods.pause().send({
        from: admin,
        gasPrice: '10000000000',
        gas: 1000000
    });

    console.log(`paused`);

    await roulette.methods.unpause().send({
        from: admin,
        gasPrice: '10000000000',
        gas: 1000000
    });

    console.log(`unpaused`);

    

    let genStart = await roulette.methods.genesisStartOnce().call();
    console.log("Genesis start round: " + genStart);
   
    if(!genStart){
        await roulette.methods.genesisStartRound().send({
            from: operator,
            gasPrice: '10000000000',
            gas: 1000000
    });

    genStart = await roulette.methods.genesisStartOnce().call();
    console.log("Genesis start round: " + genStart);

    await new Promise((resolve, _) => setTimeout(resolve, 60000)); 

    await roulette.methods.genesisEndRound().send({
        from: operator,
        gasPrice: '10000000000',
        gas: 1000000
    });

    const genEnd = await roulette.methods.genesisEndOnce().call();
    console.log("Genesis end round: " + genEnd);

    await new Promise((resolve, _) => setTimeout(resolve, 60000)); 

    await roulette.methods.closeRound().send({
        from: operator,
        gasPrice: '10000000000',
        gas: 1000000
    });

    await new Promise((resolve, _) => setTimeout(resolve, 30000)); 

    await roulette.methods.startRound().send({
        from: operator,
        gasPrice: '10000000000',
        gas: 1000000
    });

    const epoch = await roulette.methods.currentEpoch().call();
    console.log(`Round ${epoch} started`);

    let round = await roulette.methods.rounds(epoch).call();
    console.log(round);
    

    const time1 = Math.floor(new Date().getTime() / 1000);
    await roulette.methods.bet(betPlayer).send({
            from: player,
            gasPrice: '10000000000',
            gas: 2000000
        });
    const time2 = Math.floor(new Date().getTime() / 1000);
    console.log(`Player bet for 40 tokens`);
    console.log(`Time taken to bet: ${time2 - time1}`);


    const time3 = Math.floor(new Date().getTime() / 1000);
    await roulette.methods.bet(betOperator).send({
        from: operator,
        gasPrice: '10000000000',
        gas: 2000000
    });
    const time4 = Math.floor(new Date().getTime() / 1000);
    console.log(`Operator bet for 40 tokens`);
    console.log(`Time taken to bet: ${time4 - time3}`)

    const timeLeft = (round.endTime - time4)*1000;
    console.log(`timeLeft: ${timeLeft/1000}`);
    await new Promise((resolve, _) => setTimeout(resolve, timeLeft)); 

    await roulette.methods.closeRound().send({
        from: operator,
        gasPrice: '10000000000',
        gas: 1000000
    });
    
    round = await roulette.methods.rounds(epoch).call();
    console.log(round);
    
    console.log(`<<<<<-------- Round ${epoch} ended -------->>>>>`);

    console.log(`Round ${round.epoch}:\nWinning Number: ${round.winningNumber}`);

    const claimableOperator = await roulette.methods.claimable(epoch, operator).call();
    console.log(`Claimable for operator: ${claimableOperator[0]}`);
    
    const refundableOperator = await roulette.methods.refundable(epoch, operator).call();
    console.log(`Refundable for operator: ${refundableOperator}`);
    
    const claimablePlayer = await roulette.methods.claimable(epoch, player).call();
    console.log(`Claimable for player: ${claimablePlayer[0]}`);
    
    const refundablePlayer = await roulette.methods.refundable(epoch, player).call();
    console.log(`Refundable for player: ${refundablePlayer}`);

    if(claimableOperator[0]){
        await roulette.methods.claim(epoch).send({
            from: operator,
            gasPrice: '10000000000',
            gas: 1000000
        });
        console.log(`Claim operator: ${web3.utils.fromWei(claimableOperator[1])}`)
        roulette.events.Claim().on('data', async event => {
            console.log(event);
            console.log(
                `Claim Operator:\nClaimant: ${event.sender}\nAmount: ${event.amount}\nEpoch: ${event.currentEpoch}`
            );
        });   
    }

    if(claimablePlayer[0]){
        await roulette.methods.claim(epoch).send({
            from: player,
            gasPrice: '10000000000',
            gas: 1000000
        });
        console.log(`Claim player: ${web3.utils.fromWei(claimablePlayer[1])}`)
        roulette.events.Claim().on('data', async event => {
            console.log(event);
            console.log(
                `Claim Player:\nClaimant: ${event.returnValues.sender}\nAmount: ${event.returnValues.amount}\nEpoch: ${event.returnValues.currentEpoch}`
            );
        }); 
    }

    

    if(refundableOperator){
        await roulette.methods.claim(epoch).send({
            from: operator,
            gasPrice: '10000000000',
            gas: 1000000
        });
        roulette.events.Claim().on('data', async event => {
            console.log(event);
            console.log(
                `Claim Operator:\nClaimant: ${event.returnValues.sender}\nAmount: ${event.returnValues.amount}\nEpoch: ${event.returnValues.currentEpoch}`
            );
        });   
    }

    if (refundablePlayer){
        await roulette.methods.claim(epoch).send({
            from: player,
            gasPrice: '10000000000',
            gas: 1000000
        });
        roulette.events.Claim().on('data', async event => {
            console.log(event);
            console.log(
                `Claim Player:\nClaimant: ${event.returnValues.sender}\nAmount: ${event.returnValues.amount}\nEpoch: ${event.returnValues.currentEpoch}`
            );
        });
    }

    const treasuryAmt = await roulette.methods.treasuryAmount().call();

    if(treasuryAmt > 0){
        await roulette.methods.claimTreasury().send({
            from: admin,
            gasPrice: '10000000000',
            gas: 1000000
        });
        console.log(`Treasury claimed`);
        roulette.events.ClaimTreasury().on('data', async event => {
            console.log(event);
            console.log(
                `Claim Treasury:\nClaimant: ${admin}\nAmount: ${event.returnValues.amount}`
            )            
        });
    }
    
    }
}

main();