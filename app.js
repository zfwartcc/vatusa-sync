import axios from 'axios';
import dotenv from 'dotenv';
import schedule from 'node-schedule';
import { performance } from 'perf_hooks';

dotenv.config();

const syncRoster = async () => {

	const zabApi = axios.create({
		baseURL: process.env.ZAB_API_URL,
		headers: {
			'Authorization': `Bearer ${process.env.ZAB_API_KEY}`
		}
	})

	const start = performance.now();

	console.log(`Syncing Roster...`);

	const { data: vatusaData } = await axios.get(`https://api.vatusa.net/v2/facility/ZFW/roster/both?apikey=${process.env.VATUSA_API_KEY}`).catch(console.error);
	const { data: zabData } = await axios.get(`${process.env.ZAB_API_URL}/controller`);
	const allZabControllers = [...zabData.data.home, ...zabData.data.visiting];
	const { data: zabRoles } = await axios.get(`${process.env.ZAB_API_URL}/controller/role`);
	const availableRoles = zabRoles.data.map(role => role.code);

	const zabControllers = allZabControllers.map(c => c.cid); // everyone in db
	const zabMembers = allZabControllers.filter(c => c.member).map(c => c.cid); // only member: true
	const zabNonMembers = allZabControllers.filter(c => !c.member).map(c => c.cid); // only member: false
	const zabHomeControllers = zabData.data.home.map(c => c.cid); // only vis: false
	const zabVisitingControllers = zabData.data.visiting.map(c => c.cid); // only: vis: true

	const vatusaControllers = vatusaData.data.map(c => c.cid); // all controllers returned by VATUSA
	const vatusaHomeControllers = vatusaData.data.filter(c => c.membership === 'home').map(c => c.cid); // only membership: home
	const vatusaVisitingControllers = vatusaData.data.filter(c => c.membership !== 'home').map(c => c.cid); // only membership: !home

	const toBeAdded = vatusaControllers.filter(cid => !zabControllers.includes(cid));
	const toBeChecked = zabControllers;
	const makeNonMember = zabMembers.filter(cid => !vatusaControllers.includes(cid));
	const makeMember = zabNonMembers.filter(cid => vatusaControllers.includes(cid));
	const makeVisitor = zabHomeControllers.filter(cid => vatusaVisitingControllers.includes(cid));
	const makeHome = zabVisitingControllers.filter(cid => vatusaHomeControllers.includes(cid));

	console.log(`Members to be added: ${toBeAdded.join(', ')}`);
	console.log(`Members to be removed: ${makeNonMember.join(', ')}`);
	console.log(`Controllers to be made member: ${makeMember.join(', ')}`);
	console.log(`Controllers to be made visitor: ${makeVisitor.join(', ')}`);
	console.log(`Controllers to be made home controller: ${makeHome.join(', ')}`);

	const vatusaObject = {};

	for(const user of vatusaData.data) {
		vatusaObject[user.cid] = user;
	}

	for (const cid of toBeAdded) {
		const user = vatusaObject[cid];

		const assignableRoles = user.roles.filter(role => availableRoles.includes(role.role.toLowerCase())).map(role => role.role.toLowerCase());

		const userData = {
			fname: user.fname,
			lname: user.lname,
			cid: user.cid,
			rating: user.rating,
			home: user.facility,
			email: user.email,
			broadcast: user.flag_broadcastOptedIn,
			member: true,
			vis: (user.membership === 'home') ? false : true,
			roleCodes: (user.membership === 'home') ? assignableRoles : [],
			createdAt: user.facility_join
		}

		await zabApi.post(`/controller/${user.cid}`, userData);
	}
	for (const cid of vatusaControllers){
		const user = vatusaObject[cid];
		await zabApi.put(`/controller/${cid}/rating`, {rating: user.rating});
	}

	for (const cid of makeMember) {
		await zabApi.put(`/controller/${cid}/member`, {member: true});
	}

	for (const cid of makeNonMember) {
		await zabApi.put(`/controller/${cid}/member`, {member: false});
	}

	for (const cid of makeVisitor) {
		await zabApi.put(`/controller/${cid}/visit`, {vis: true});
	}

	for (const cid of makeHome) {
		await zabApi.put(`/controller/${cid}/visit`, {vis: false});
	}

	console.log(`...Done!\nFinished in ${Math.round(performance.now() - start)/1000}s\n---`);
}

(() => {
	syncRoster();
	schedule.scheduleJob('*/10 * * * *', syncRoster);
})();
